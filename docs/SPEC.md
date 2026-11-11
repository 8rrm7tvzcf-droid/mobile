# MyGarage — Specifica di prodotto e tecnica

| Campo | Valore |
|---|---|
| Prodotto | **MyGarage**, app mobile (iOS e Android) in italiano per la gestione delle proprie auto |
| Nome tecnico del progetto | AutoGarage (cartella del progetto sul PC; il repository è la sottocartella `mobile/`, con questi documenti in `docs/`) |
| Data della specifica | 2026-10-07 |
| Autore | Architetto capo (sintesi di cinque ricerche: `docs/research/features.md`, `obd.md`, `stack.md`, `regs.md`, `data.md`) |
| Destinatari | Lo sviluppatore singolo (con Claude Code) e chiunque debba valutare il progetto |
| Stato | Specifica completa per l'avvio della Fase 0; le verifiche ancora aperte sono nella sezione 15 |

## 0. Come leggere questo documento

### 0.1 Convenzioni

| Elemento | Significato |
|---|---|
| **P0** | Bloccante: senza di essa il primo rilascio pubblico (MVP) non esce. Tutte le P0 sono in fase MVP |
| **P1** | Importante: costruita nell'MVP se costa poco, altrimenti in V1 |
| **P2** | Utile: V1 o V2, solo dopo aver visto come usano l'app persone reali |
| **MVP / V1 / V2** | MVP = primo rilascio pubblico (Fasi 1-3 del piano, sezione 12). V1 = aggiornamenti entro 3-6 mesi dal lancio. V2 = dopo aver misurato la domanda |
| **F-xx** | Funzionalità (sezione 3). **W-xx** = esclusione dichiarata. **S-xx** = schermata. **AC-xx** = criterio di accettazione. **NFR-xx** = requisito non funzionale. **D-xx** = decisione. **R-xx** = rischio. **SP-x** = spike tecnico |
| **Confidenza** | *alta* = confermata da fonte primaria o dal codice letto/eseguito; *media* = fonte secondaria autorevole o coerenza tra più ricerche; *bassa* = ipotesi da provare |
| **[DA VERIFICARE]** | Punto che nessuna ricerca ha confermato; non va trattato come fatto |
| **[SPIKE]** | Punto che si chiude solo provando su dispositivo/auto reale (sezione 12) |
| **Riferimenti alle ricerche** | `[FEA §n]` = `features.md`, `[OBD §n]` = `obd.md`, `[STK §n]` = `stack.md`, `[REG §n]` = `regs.md`, `[DAT §n]` = `data.md`. Gli URL primari sono nell'appendice B |

### 0.2 Affidabilità delle fonti usate

| Ricerca | Stato | Note |
|---|---|---|
| `obd.md` | verificata da uno scettico indipendente il 2026-10-07 (nessuna smentita tecnica; 8 correzioni integrate) | gli UUID GATT non-OBDLink e il layout OBFCM restano ipotesi |
| `stack.md` | verificata da uno scettico indipendente il 2026-10-07 (nessuna smentita centrale; 12 correzioni) | nessuna libreria nativa è stata provata su hardware: serve lo spike |
| `regs.md` | verificata da uno scettico indipendente il 2026-10-07 (4 smentite, 10 correzioni, tutte integrate) | alcune norme restano a confidenza media o bassa (sezione 7) |
| `features.md` | NON verificata da uno scettico; analisi di recensioni e schede store del 2026-10-06 | le percentuali sulle lamentele sono un'euristica a parole chiave, non una statistica; i prezzi Drivvo sono riferiti da utenti |
| `data.md` | progettazione con 240 controlli automatici eseguiti su PC (Node 24.19, SQLite 3.53.3); non verificata da uno scettico | nulla è stato provato su telefono (Hermes, versione SQLite di `expo-sqlite`, notifiche reali) |

Dove le ricerche si contraddicono vale la regola: *prima il testo verificato da fonte primaria, poi la ricerca verificata, poi quella non verificata*. Le contraddizioni trovate e come sono state risolte sono nella sezione 2.6.

### 0.3 Cosa è stato ricontrollato per scrivere questa specifica

- Versioni npm dei pacchetti principali, riletta il 2026-10-07 con `npm view` (tabella in sezione 9): coincidono con `stack.md`. Il template `expo-template-default@sdk-57` (57.0.29) fissa React Native 0.86.3, React 19.2.3 e TypeScript ~6.0.3. Su npm `expo` ha `latest` = 57.0.27 e `next` = 58.0.6 (SDK 58 ancora in beta, nessuna uscita stabile).
- Collisioni del nome sull'App Store italiano (ricerca iTunes del 2026-10-07): nessuna app chiamata «MyGarage» tra i primi risultati; «Libretto» è saturo di app per libretti universitari. Non sono stati controllati Google Play, UIBM ed EUIPO (vedi sezione 1.3).
- Nessuna nuova ricerca web: le cinque ricerche sono recenti (2026-10-06/07) e il budget d'uso è stato riservato alla sintesi.

## 1. Visione, nome e utenti

### 1.1 Visione

> **MyGarage è il libretto digitale della tua auto e il suo cruscotto OBD: sai in dieci secondi se sei in regola e cosa ti serve nei prossimi mesi, i dati restano tuoi, e se colleghi un adattatore l'app legge quello che l'auto davvero espone.**

MyGarage unisce tre cose che oggi vivono in app separate:

1. il **libretto di manutenzione** (tagliandi, cambio olio, interventi, rifornimenti, spese, documenti);
2. lo **scadenzario italiano** (assicurazione, bollo, revisione, tagliando, gomme, bombole) con avvisi che arrivano davvero;
3. la **lettura OBD via Bluetooth** (codici guasto, spia motore, dati live, tensione, carburante) salvata nello stesso storico.

### 1.2 Il problema e l'opportunità (evidenza)

| Fatto | Fonte | Confidenza |
|---|---|---|
| Il mercato è spaccato: le app garage (Drivvo, Fuelio, Simply Auto, aCar, My Car) non hanno OBD; le app OBD (Car Scanner, Torque, OBD Fusion, Carly) non hanno scadenze, interventi, spese. Chi unisce le due cose (FIXD) è centrato sugli USA e costa 99,99 USD/anno | [FEA §14, §9] | media |
| Le lamentele più frequenti nelle recensioni da 1-2 stelle di 9 app (3.259 recensioni, euristica): soldi, paywall e abbonamenti; perdita di dati e sincronizzazione rotta; connessione OBD instabile (15% in generale, 19-34% nelle app OBD); app abbandonate senza supporto | [FEA §13] | media (campione recente, non rappresentativo) |
| Le app italiane di scadenze (UnipolMove, ACI Space, IO) richiedono account o identità digitale e non trattano tagliandi, olio, livelli né OBD | [FEA §11] | alta |
| A settembre-ottobre 2026 le recensioni di Drivvo (5M+ installazioni Android) riportano sincronizzazione ed export diventati a pagamento, prezzo Pro aumentato e un avviso sulla condivisione della posizione. **Sono dichiarazioni di utenti, non confermate da un annuncio ufficiale** (il sito dice ancora «free forever»): non vanno usate nel marketing | [FEA §1, domande aperte] | media/bassa |
| Nessuna app consumer ha OCR on-device del Documento Unico | [FEA §24 D5] | media |

L'opportunità è un'app **italiana, locale, esportabile e senza pubblicità** che sia utile dal primo minuto anche senza adattatore.

### 1.3 Nome e identità

**Nome scelto dall'utente: MyGarage** (8 ottobre 2026). La specifica era stata scritta con il nome provvisorio «Cofano»: tutte le verifiche su nomi e collisioni citate nelle ricerche riguardavano quel nome e **non valgono per MyGarage**.

| Aspetto | Stato |
|---|---|
| Rischio noto | La ricerca sugli store (iTunes IT, 2026-10-07) ha trovato app garage già affermate con nomi molto vicini («My Garage», «My Car», «Scanner Veicoli»). «MyGarage» è un nome generico: rischio **concreto** di collisione negli store e di marchio debole |
| Non verificato | Disponibilità su Google Play, registro marchi UIBM/EUIPO, dominio e profili social. Da controllare **prima** di fissare bundle id e grafica |
| Mitigazione | Sottotitolo distintivo negli store (es. «Libretto auto, scadenze e OBD»); eventuale nome esteso («MyGarage – Libretto auto»); «Tagliando» resta parola chiave del sottotitolo |
| Alternative scartate in origine | «Tagliando» (descrittivo, marchio debole), «Garagino», «Libretto» (saturo) |

**Testi di vetrina proposti** (da rifinire; i limiti di lunghezza degli store vanno verificati in App Store Connect e Play Console):

- Sottotitolo/descrizione breve: «Libretto auto, scadenze e OBD».
- Promessa: «Il libretto digitale della tua auto. Dati tuoi, nessun account, nessuna pubblicità.»
- Dichiarazioni obbligatorie: «Nessuna pubblicità, nessun tracciamento», «Funziona offline», «Esporta tutto quando vuoi».

**Identificatori tecnici.** Rinominati (8 ottobre 2026) in `mg1:` (chiavi delle notifiche), `mygarage.backup` (formato di backup), `mygarage://` (collegamenti interni) e `mygarage.db` (file del database). L'identificatore dell'app (bundle id / package name) è **permanente dopo la pubblicazione**: non è ancora impostato e va fissato solo dopo aver confermato nome e titolare dell'account sugli store (domande 1 e 2).

### 1.4 Utenti e bisogni

Utenti finali: **automobilisti italiani** con una o più auto (uso privato; non flotte, non B2B: [FEA §21]).

| Persona | Chi è | Cosa vuole | Funzioni chiave |
|---|---|---|---|
| **Marco, 38 anni** | Una Panda a benzina/GPL del 2016, usa il telefono per tutto, odia gli abbonamenti, ha già dimenticato una revisione | Non scordare assicurazione, bollo, revisione, tagliando; sapere quanto spende | F-12, F-13, F-19..F-28, F-39, F-42 |
| **Giulia, 45 anni** | Due auto di marche diverse in famiglia, tagliandi dal meccanico di fiducia, tra un anno vorrà vendere una delle due | Tutto in un'app neutra rispetto alle marche; uno storico dimostrabile per la rivendita; ricevute e libretto sempre a portata di mano | F-01, F-35..F-37, F-47, F-50, F-06 |
| **Luca, 29 anni** | Ha comprato un adattatore ELM327 online; la spia motore si accende e vuole capire perché, senza pagare per cancellare i codici | Collegare l'adattatore, leggere i codici in italiano, vedere dati live e tensione, salvare quello che trova nello storico | F-56..F-62, F-64, F-65, F-66 |
| **Rosa, 68 anni** *(secondaria)* | Un'auto da molti anni, vista e destrezza ridotte, usa il telefono con testo grande | Pochi passaggi, testo grande, un avviso chiaro prima di ogni scadenza | F-12, F-15, F-24, F-27 |

**Job to be done:** «Quando si avvicina una scadenza, voglio saperlo per tempo e sapere cosa fare»; «Quando il meccanico mi consegna l'auto, voglio registrare l'intervento in meno di un minuto»; «Quando si accende una spia, voglio capire se è grave»; «Quando vendo l'auto, voglio dimostrare come l'ho tenuta».

### 1.5 Principi di prodotto

| ID | Principio | Conseguenza concreta |
|---|---|---|
| P-01 | **Il dato è dell'utente** | Archivio locale, nessun account, nessuna pubblicità, esportazione e backup sempre gratuiti e mai dietro paywall; se l'app non viene più aggiornata l'esportazione resta |
| P-02 | **Utile dal minuto uno, senza adattatore** | Tutte le funzioni P0 non-OBD funzionano senza hardware; l'OBD arricchisce, non è un prerequisito |
| P-03 | **Onestà sui dati** | Ogni valore dichiara se è *letto dall'auto*, *stimato* o *inserito da te*; non si promette ciò che l'OBD standard non espone |
| P-04 | **Una scadenza non si perde** | Notifiche locali con finestra mobile e sentinella, banner in app, schermata «Verifica notifiche», calendario `.ics` |
| P-05 | **L'Italia è la funzione** | Regole italiane (revisione 4+2, bollo, RC senza tacito rinnovo, gomme, bombole) precaricate ma **sempre modificabili**, con fonte e data di verifica visibili |
| P-06 | **Inserire è veloce** | Un rifornimento in meno di 10 secondi; un controllo livello in 3 tocchi; un intervento in meno di un minuto |
| P-07 | **Nessuna sorpresa a pagamento** | Prezzo bloccato per chi ha già acquistato, nessuna licenza revocata, nessun abbonamento settimanale, nessun addebito a sorpresa |
| P-08 | **Sicurezza prima** | OBD in sola lettura nell'MVP; la cancellazione dei codici è protetta da avvisi; nessun coding ECU; l'app non va usata alla guida |
| P-09 | **Leggibile da tutti** | Testo ridimensionabile, contrasto 4,5:1, semafori sempre con icona e testo, bersagli grandi |
| P-10 | **Costruita per durare** | Architettura a strati testabile su PC, aggiornamento a ogni SDK Expo, pagina «Stato del progetto» pubblica: l'abbandono è la prima lamentela dei concorrenti |

## 2. Decisioni di prodotto

### 2.1 Le tre prospettive esaminate

**A — «MVP solido prima di tutto».** Si costruisce prima il nucleo local-first: garage, interventi, scadenze, rifornimenti, spese, documenti, backup, notifiche affidabili. L'OBD arriva dopo.
- *Forza:* aggredisce le cause di recensione negativa che non riguardano l'hardware (perdita di dati: 47% Simply Auto, 35% aCar, 22% My Car; paywall su export e sincronizzazione; promemoria che non arrivano su Drivvo iOS e My Car) [FEA §13, §27]. Costo basso; testabile quasi tutto su PC [DAT §8].
- *Debolezza:* non risponde alla prima frase della richiesta («collegare le tue auto tramite bluetooth e scaricare tutte le informazioni») e resta «un'altra app garage».

**B — «Attacca l'adattatore e l'app compila da sola».** L'esperienza ruota attorno al collegamento OBD: l'app legge l'auto e popola tutto.
- *Forza:* effetto sorpresa, differenziazione dalle app garage, risponde alla richiesta esplicita.
- *Debolezza (evidenza forte):* l'OBD standard **non** espone livello olio, vita olio, intervallo service, pressione gomme, usura freni, stato batteria 12 V, SoC/SoH delle elettriche; il chilometraggio (PID 01A6) dipende dal costruttore; tagliandi, assicurazione e bollo sono dati *umani* che nessun adattatore conosce [OBD §17, §13]. Su iOS funzionano solo adattatori BLE o Wi-Fi (i Bluetooth Classic economici no) [OBD §2]. La connessione è la prima fonte di frustrazione delle app OBD (OBD Fusion 34%, Torque 23%, Carly 22%, Car Scanner 19% delle recensioni negative) [FEA §13]. Promettere «compila da sola» riproduce il pattern «ho pagato ma la mia auto non è supportata», che genera la maggior parte delle recensioni a 1 stella. Ogni prova richiede hardware reale e Apple chiede un video con l'adattatore in App Review [OBD §23].

**C — «Assistente di scadenze e costi per l'Italia».** Il valore è sapere cosa scade, quando, quanto costa tenere l'auto, con regole italiane precaricate.
- *Forza:* funziona con il 100% delle auto, offline, senza hardware; valore ricorrente ogni mese; le regole italiane sono state verificate su fonti primarie [REG]; nessuna app consumer unisce scadenzario IT, tagliandi, spese e OBD senza account [FEA §14].
- *Debolezza:* un errore normativo può far prendere una multa all'utente; il promemoria bollo è una commodity gratuita (app IO); UnipolMove è gratuita grazie alla base assicurativa [FEA §11].

### 2.2 Confronto (giudizio dell'architetto su scala 1-5, 5 = meglio; non è una misura)

| Criterio | A | B | C | Sintesi scelta |
|---|---|---|---|---|
| Copre la richiesta dell'utente | 3 | 5 (solo in apparenza) | 4 | 5 |
| Valore dal primo minuto, senza hardware | 5 | 1 | 5 | 5 |
| Rischio tecnico (basso = punteggio alto) | 5 | 1 | 4 | 3 (isolato nell'OBD) |
| Rischio recensioni negative/rimborsi | 5 | 1 | 4 | 4 |
| Differenziazione dai concorrenti | 2 | 4 | 4 | 5 |
| Fattibilità per uno sviluppatore singolo | 5 | 2 | 4 | 4 (con fasi) |
| Indipendenza da hardware e piattaforma | 5 | 1 | 5 | 4 |

### 2.3 Sintesi scelta: «Prima il libretto, poi il cavo»

Si prende **da A la disciplina di costruzione, da C il valore quotidiano, da B l'arricchimento — ridimensionato a ciò che è vero**.

1. **Fondamenta (A):** archivio locale SQLite, backup, notifiche affidabili, test su PC. Non negoziabili e prime nel piano (Fasi 0-1).
2. **Valore quotidiano (C):** scadenzario italiano con semafori, interventi e cambio olio, rifornimenti, spese, livelli manuali guidati, documenti. È ciò per cui si apre l'app ogni settimana e funziona con qualsiasi auto.
3. **Arricchimento (B):** il collegamento OBD è **opzionale e mai un prerequisito**. Legge ciò che l'auto espone, lo etichetta «letto dall'auto» e lo salva nella stessa timeline dei tagliandi. Prima di tutto mostra un *report di compatibilità* («cosa legge la tua auto»). Esiste una **modalità demo** con adattatore simulato (serve anche ad App Review). Non si promette mai «compila da sola»: l'app può **proporre** di aggiornare km e carburante, e l'utente conferma.
4. **Perché l'OBD è nell'MVP e non rimandato:** è la prima richiesta dell'utente e il differenziatore rispetto alle app garage; il rischio si contiene con sola lettura, report di compatibilità, adattatori consigliati, demo e un solo trasporto (BLE) all'inizio.
5. **Regola di robustezza:** se il collegamento OBD fallisce, l'utente non perde nulla; ogni funzione P0 non-OBD resta intera.

### 2.4 Decisioni principali

| ID | Decisione | Alternative scartate | Motivo | Confidenza |
|---|---|---|---|---|
| D-01 | Sintesi A+C+B come da 2.3 | Una sola prospettiva | Vedi 2.1-2.2 | alta |
| D-02 | **Local-first, nessun account, nessun cloud, nessuna rete con dati dell'utente** nell'MVP | Cloud proprietario; account obbligatorio | Il rischio principale degli utenti è perdere i dati o essere tenuti in ostaggio; nessun server da gestire; privacy semplice [FEA §24 D1, DAT §5.7] | alta |
| D-03 | **Expo SDK 57 + React Native 0.86.3 (New Architecture) + TypeScript**, build native nel cloud con EAS e development build | Flutter (licenza commerciale di `flutter_blue_plus` per aziende, serve Android SDK); nativo Kotlin+Swift (incompatibile con i vincoli: Windows senza SDK) | Unico percorso che rispetta Windows senza Android SDK/Xcode, un solo codebase, anteprima web con OBD simulato [STK §2] | media-alta |
| D-04 | **BLE come trasporto di base** (iOS e Android); Wi-Fi e Bluetooth Classic (solo Android) in V1; Classic **promosso a MVP** se l'adattatore dell'utente è Classic e lo spike lo consente | Classic subito; MFi | iOS non supporta Classic senza MFi; `react-native-bluetooth-classic` è solo release candidate [OBD §2, §25; STK §4] | media |
| D-05 | **SQL scritto a mano dietro la porta `SqlDatabase`**, nessun ORM; migrazioni in TypeScript con runner transazionale | Drizzle ORM (proposto in `stack.md`) | Lo schema usa trigger, indici parziali, `STRICT`, viste e `CHECK` che un ORM non esprime; 240 controlli già eseguiti su quel DDL [DAT §8.7] | alta |
| D-06 | **OBD in sola lettura nell'MVP**; cancellazione dei codici (Mode 04) in V1 dietro «modalità avanzata» e doppia conferma; **nessun coding, reset service, rigenerazione DPF, freno elettrico** (esclusioni W-01, W-02) | Offrire coding come i concorrenti | Sono la prima fonte di 1 stella e di responsabilità; richiedono manutenzione per modello [FEA §21] | alta |
| D-07 | Ogni dato porta una **provenienza**: *letto dall'auto* / *stimato* / *inserito da te* | Mostrare tutto come equivalente | Onestà (P-03); evita la sfiducia dei concorrenti [OBD §17] | alta |
| D-08 | Le **scadenze di legge** e gli **intervalli di manutenzione** hanno categorie, colori e avvertenze diversi; i secondi sono sempre «indicativi» e il libretto del costruttore prevale | Un'unica lista | Le prime hanno norma e sanzione; le seconde sono consigli [REG §9] | alta |
| D-09 | **Non si calcolano importi** (bollo, sanzioni): campo manuale e link ai servizi ufficiali; gli importi delle sanzioni vivono in un file di configurazione versionato e si rivedono dopo il 1/12/2026 | Calcolo del bollo per Regione | Troppe variabili regionali; gli importi possono cambiare dal 1/1/2027 (art. 195 c.3 CdS) [REG §2.4, §10] | alta |
| D-10 | **Notifiche locali solo con trigger `DATE`**, finestra mobile di 60, sentinella, nessun allarme esatto Android | Trigger ricorrenti nativi; `SCHEDULE_EXACT_ALARM` | Comportamento identico e testabile su iOS e Android; limite iOS di 64; evita revisione policy Play [DAT §4; STK §5] | media-alta (da provare su dispositivi: SP-3) |
| D-11 | **Backup ed esportazione nell'MVP**; sincronizzazione cloud **no** (V1: backup automatico su una cartella scelta dall'utente; V2: sync E2E solo se c'è domanda) | Sync subito | Il backup è la funzione più importante di un'app local-first; la sync costa server e obblighi GDPR [DAT §5.7] | alta |
| D-12 | **Niente SQLCipher nell'MVP**; blocco app biometrico come blocco dell'interfaccia | Cifratura del DB subito | Il rischio principale è perdere la chiave (Keystore non sopravvive alla disinstallazione) e non la fuga di dati; gli allegati resterebbero in chiaro comunque [DAT §6.4] | media |
| D-13 | **Nessuna pubblicità, nessun analytics, nessun SDK di terzi che trasmetta dati** | Analytics anonimi | Promessa pubblica «nessun tracciamento»; le dichiarazioni degli store devono essere vere [DAT §6.2] | alta |
| D-14 | Modello economico **proposto**: gratis per sempre tutto il registro dati e la lettura OBD di base; **Pro una tantum 14,99-19,99 EUR** dal V1 per OCR, widget, PDF rivendita, log OBD avanzato; MVP senza acquisti in app (libreria di acquisto non ricercata) | Abbonamento; pubblicità | Evita le lamentele sui paywall; riduce il lavoro dell'MVP [FEA §25] | media (domanda all'utente n. 4) |
| D-15 | **Elettriche e ibride**: solo i dati standard disponibili; i dati batteria arrivano solo con profili di marca validati su auto reali (V2) | Promettere SoC/SoH | Non esiste uno standard per i PID batteria dei BEV [OBD §21] | alta |
| D-16 | **Solo italiano nell'MVP**, ma con i18next e nessuna stringa concatenata, pronto per altre lingue | Italiano+inglese subito | Pubblico italiano; evita la traduzione mista dei concorrenti [FEA §26] | alta |
| D-17 | **Date di calendario (`YYYY-MM-DD`) per tutto il dominio**; istanti UTC solo per audit, sessioni OBD e snooze; denaro in centesimi, prezzi in millesimi, km interi | Date locali, float | Ora legale e fusi non possono rompere il conteggio dei giorni; nessun errore di arrotondamento [DAT §1.1, §7] | alta |
| D-18 | **Architettura a strati con porte e adattatori**, regole di dipendenza imposte da `dependency-cruiser`; quasi tutto si prova su PC | Logica nei componenti | Unico modo di testare senza Android SDK [DAT §8] | alta |

### 2.5 Come interpretiamo la richiesta dell'utente

| Frase della richiesta | Interpretazione adottata | Perché |
|---|---|---|
| «un'app perfetta» | «Perfetta» non è verificabile: la traduciamo in requisiti misurabili (sezioni 10 e 11) e in principi (1.5) | Un criterio non misurabile non si può accettare |
| «collegare le tue auto tramite bluetooth» | Collegamento a un adattatore OBD-II/ELM327 via BLE (iOS e Android), poi Classic (Android) e Wi-Fi | Le auto non espongono Bluetooth proprio per questo scopo: serve un adattatore [OBD §2] |
| «scaricare tutte le informazioni» | «**Tutto ciò che la tua auto espone con l'OBD standard**», preceduto da un report di compatibilità; ciò che non è standard si inserisce a mano o si stima | Promettere «tutto» produrrebbe le recensioni a 1 stella dei concorrenti [FEA §15, OBD §17] |
| «livello» | Tre significati: carburante (letto via OBD se supportato, altrimenti dai rifornimenti), liquidi e pressione gomme (controlli manuali guidati con promemoria), temperature e tensione batteria (letti via OBD) | Olio, refrigerante, freni, lavavetri, AdBlue e TPMS non hanno PID standard [OBD §17] |
| «e tutto» | Elenco chiuso e verificabile: gomme, documenti, spese, costi al km, revisione, bollo, backup, storico per la rivendita (sezione 4) | Un «tutto» aperto non si può pianificare né collaudare |
| «iOS + Android» | Entrambe; su iOS niente Bluetooth Classic | Vincolo di piattaforma Apple [OBD §2] |

### 2.6 Contraddizioni tra le ricerche e come sono state risolte

| ID | Tema | Cosa dicono le ricerche | Decisione |
|---|---|---|---|
| RC-01 | Versione di React Native | `features.md` cita 0.87.1 (ultima su npm); `stack.md` e `obd.md`: 0.86.x | **0.86.3**: è la versione fissata da SDK 57; installare `react-native@latest` (0.87.1) rompe la build nativa [STK §3, §8; riletto con `npm view` il 2026-10-07] |
| RC-02 | Accesso ai dati | `stack.md` §7.3: Drizzle ORM 0.45.3 + drizzle-kit; `data.md` §8.7: SQL a mano | **SQL a mano** (D-05). Rimossi dallo stack: `drizzle-orm`, `drizzle-kit`, `babel-plugin-inline-import` e la regola Metro per i file `.sql` |
| RC-03 | Tetto delle notifiche pianificate | `stack.md`: circa 50; `data.md`: 60 (59 + sentinella) sotto il limite iOS di 64 | Default **60**, configurabile (`notify.maxScheduled`); si conferma con SP-3 |
| RC-04 | Intervalli di manutenzione | `regs.md` §11: tagliando 20.000 km/12 mesi; `data.md` §1.5: 15.000 km/12 mesi e altri valori | Catalogo canonico = seed di `data.md` (testato, `is_indicative=1`); `regs.md` §9 è la fonte dei range. Tutti editabili; da validare su 3-5 libretti (SP-9) |
| RC-05 | Revisione «entro il mese» | `features.md` la dà per regola; `regs.md` §1.1: è prassi MIT, non testo di legge | Calcolo a fine mese con avvertenza e override manuale |
| RC-06 | Revisione con scantool «dal 24-02-2024» | `features.md`: dal 24-02-2024; `obd.md` §16 (corretto): è la data entro cui i centri si dotano dello strumento | Formula corretta in 5.5 e nei testi |
| RC-07 | Scadenza del bollo | `features.md`: si paga entro la fine del mese successivo alla scadenza; `regs.md` §2.2: distinguere «fine validità» da «termine di versamento» | Il campo si chiama **«mese di pagamento»** (ultimo mese utile per versare) |
| RC-08 | Tolleranza RC di 15 giorni | `features.md`/`data.md`: da verificare; `regs.md` §3.1: testo dell'art. 170-bis letto | Confermata come *ponte* verso la nuova polizza, non come proroga: il promemoria usa la data di fine polizza |
| RC-09 | Expo Go | `stack.md`: login obbligatorio dal 3-9-2026 (iOS); disponibilità Android per SDK 57 non confermata | Non si dipende da Expo Go: UI su PC in web, prove native con development build |
| RC-10 | Preavvisi delle notifiche | `regs.md`: serie proposte diverse; `data.md`: offset testati per template | Si usano gli offset di `data.md` (tabella 7.1); l'utente può modificarli |
| RC-11 | Gomme con indice di velocità inferiore | `features.md` §17 parla di sostituzione dal 15/5 al 15/10 e di sanzione 422-1.695 EUR; `regs.md` §4.1 (verificato): montaggio ammesso dal 15/10 al 15/5 con indice non inferiore a Q (circolare MIT 1049/2014) | Si segue `regs.md`; nessun importo mostrato per questa regola |
| RC-12 | Prezzi e accuse a Drivvo | `features.md`: riferiti da utenti | Mai usati nel marketing finché non confermati da fonte ufficiale |
| RC-13 | Nome della cartella `src/app` | `data.md` la usa per i casi d'uso; `stack.md` e il template SDK 57 la usano per le rotte di expo-router | `src/app` = solo rotte; i casi d'uso stanno in **`src/usecases`** (sezione 8.6) |
| RC-14 | Notifiche: nome del task e prefissi | `data.md`: `ag1:`, `ag-replan`, `autogarage.backup` | Rinominati `mg1:`, `mg-replan`, `mygarage.backup` (sezione 1.3) |

## 3. Mappa delle funzionalità

Totale: 85 funzionalità (44 P0, 12 P1 pianificate nell'MVP, 29 tra P1 e P2 in V1 e V2: vedi i conteggi in 3.7). Le P0 e le P1 dell'MVP formano il primo rilascio (56 funzionalità). Per ogni voce la colonna «Note» indica dipendenze, ricerca di origine e rischi.

### 3.1 Fondamenta e dati

| ID | Funzione | Cosa fa | Pri | Fase | Note |
|---|---|---|---|---|---|
| F-01 | Garage multi-veicolo | Aggiunge, modifica, archivia (venduta, rottamata) auto senza limite artificiale. Dati: soprannome, targa e VIN facoltativi, marca, modello, anno, prima immatricolazione, alimentazione primaria e secondaria (benzina, gasolio, GPL, metano, elettrico), potenza kW, classe Euro, serbatoio | P0 | MVP | Targa e VIN normalizzati maiuscoli senza spazi; «Panda di Marco» senza targa è valido [DAT §1.2, §6.2] |
| F-02 | Scheda auto | Pagina riassuntiva: semaforo delle scadenze, km attuali con provenienza, ultimo intervento, costo al km, prime 3 scadenze, accessi a registro, documenti, OBD, costi | P0 | MVP | |
| F-03 | Registro chilometri | Fonte unica dei km: rifornimenti, interventi, controlli e letture OBD creano una lettura collegata; coerenza monotona garantita; lettura errata ignorabile; media km/giorno robusta | P0 | MVP | Evita le tre copie divergenti dei km dei concorrenti [DAT §1.2, §3.4] |
| F-04 | Allegati | Foto e PDF nello storage privato dell'app (mai in galleria), ridimensionati in ingresso (lato lungo 2048 px, JPEG circa 80%), con hash SHA-256 | P0 | MVP | Tetto di memoria dello ZIP: [DAT §5.3] |
| F-05 | Cestino e annulla | Eliminazione recuperabile per 30 giorni; conferma esplicita prima di eliminare un veicolo; «Elimina definitivamente»; annulla di un completamento | P0 | MVP | My Car cancellava senza avviso [FEA §10] |
| F-06 | Backup | Esporta ZIP completo (manifest, dati, allegati con hash) con il foglio di condivisione; stato «ultimo backup: oggi»; promemoria dopo 30 giorni e almeno 5 modifiche | P0 | MVP | Mai dietro paywall (P-01) |
| F-07 | Ripristino e importazione | Modalità «Sostituisci» e «Unisci» con riepilogo prima di confermare, copia di sicurezza automatica, transazione con rollback totale, controllo degli hash | P0 | MVP | [DAT §5.5] |
| F-08 | Esportazione CSV | Un CSV per entità; due varianti: Excel italiano (`;`, UTF-8 con BOM, `gg/mm/aaaa`, virgola decimale) e dati (`,`, ISO); protezione da CSV injection | P0 | MVP | [DAT §5.4] |
| F-09 | Cancella tutti i dati | Procedura verificabile: notifiche, database, allegati, copie, chiavi; avviso che i backup già condivisi non si cancellano dall'app | P0 | MVP | GDPR, diritto alla cancellazione [DAT §6.3] |
| F-10 | Blocco app | Biometria o codice del dispositivo, timeout 0/30/60/300/900 s, schermata neutra nel selettore app, nuova autenticazione per esportare o cancellare | P1 | MVP | È un blocco dell'interfaccia, non cifratura [DAT §6.5] |
| F-11 | Impostazioni | Unità, notifiche (ora, riservatezza del testo), tema, backup, blocco, adattatori OBD, informazioni | P0 | MVP | |
| F-12 | Onboarding | In meno di 2 minuti: prima auto, 3 scadenze iniziali, permesso notifiche chiesto dopo la prima scadenza, permesso Bluetooth chiesto solo al tocco su «Collega auto» | P0 | MVP | [FEA §23] |
| F-13 | Dashboard «Oggi» | Scheda «Prossima scadenza», semafori per categoria, elenco «Da fare», banner (backup, notifiche spente, aggiorna i km) | P0 | MVP | |
| F-14 | Azione rapida «+» | Rifornimento, intervento, spesa, controllo livello, aggiornamento km, documento, scadenza | P0 | MVP | |
| F-15 | Accessibilità e temi | Chiaro e scuro, ingrandimento testo fino al 200%, etichette per lettori di schermo su ogni controllo (anche grafici e gauge), semafori con icona e testo, riduzione animazioni | P0 | MVP | NFR-05..NFR-07 |
| F-16 | Localizzazione it-IT | Date, numeri e valuta italiani; input che accetta virgola e punto; plurali corretti; terminologia (tagliando, RCA, bollo, revisione, GPL, metano) | P0 | MVP | Formattazione manuale deterministica [DAT §7.4] |
| F-17 | Auto demo | Un'auto di prova precaricata e cancellabile per esplorare l'app senza inserire dati | P1 | MVP | Utile anche per App Review |
| F-18 | Stato del progetto e informative | Pagina in app con versione, data dell'ultimo aggiornamento, contatto e tempi di risposta, informativa privacy, licenze di terzi | P0 | MVP | La privacy policy in app e nello store è obbligatoria (guideline 5.1.1(i)) [STK §6.2]; l'abbandono è la prima lamentela dei concorrenti |

### 3.2 Scadenze

| ID | Funzione | Cosa fa | Pri | Fase | Note |
|---|---|---|---|---|---|
| F-19 | Motore scadenze | Regola «il primo dei due» (data o km). Tre tipi: dall'ultimo fatto, serie di calendario, data fissa. Stato calcolato e mai salvato; riconciliazione idempotente | P0 | MVP | TypeScript puro, 53 vettori eseguiti [DAT §3] |
| F-20 | Imposta le scadenze (wizard e catalogo) | Propone le voci del catalogo (27) compatibili con l'alimentazione; per ognuna chiede «quando l'hai fatto l'ultima volta?» (data e km / non lo so / mai). «Non lo so» non inventa nulla: la voce resta «Da configurare» | P0 | MVP | [DAT §1.5] |
| F-21 | Revisione | Prima revisione a 4 anni dall'immatricolazione, poi ogni 2 anni, a fine mese; si sovrascrive con la data letta sul documento; avvertenza; suggerimento «leggi la spia motore prima di prenotare» | P0 | MVP | Sezione 7.2 [REG §1] |
| F-22 | Bollo | Campo «mese di pagamento», nessun importo, link ad ACI, pagoPA, app IO; regole con data di decorrenza; etichetta informativa sull'esenzione 2027 | P0 | MVP | Sezione 7.3 [REG §2] |
| F-23 | Scadenze personalizzate | Titolo, data, ricorrenza (giorno, settimana, mese, anno, ancorata all'origine), km facoltativi, ora per il giorno stesso | P0 | MVP | [DAT §3.8] |
| F-24 | Semafori e stati | Rosso: scaduta o scade oggi. Giallo: in arrivo. Verde: in regola. Grigio: da configurare. Sempre icona e testo («Scaduta da 3 giorni») | P0 | MVP | Sezione 6.3.4 |
| F-25 | Fatto, Rimanda, Salta | Completamento con data e km reali che ricalcola il prossimo; rimando (domani, 3 giorni, 1 settimana, +N km); annulla | P0 | MVP | Il prossimo intervallo parte dai valori reali [DAT §3.7] |
| F-26 | Previsione dei km | Data stimata per le scadenze a km con media pesata; invito «Aggiorna i km» se l'ultima lettura ha più di 30 giorni e c'è una scadenza a km entro 90 giorni; tutto etichettato «stima» | P0 | MVP | Parametri da tarare con dati reali [DAT §3.4] |
| F-27 | Notifiche locali | Solo trigger `DATE`, finestra di 60, sentinella, diff idempotente, ripianificazione a ogni apertura e modifica, testo con soprannome e non targa, canali Android | P0 | MVP | [DAT §4] |
| F-28 | Verifica notifiche | Permesso, stato dei canali, notifiche attese contro presenti, prova a 10 secondi, guida al risparmio energetico | P0 | MVP | Risposta alla lamentela «le notifiche non arrivano» [FEA §27] |
| F-29 | Gomme stagionali | Promemoria informativi 15/11 e 15/4 (l'obbligo vale solo dove c'è ordinanza), spenti di default | P1 | MVP | Sezione 7.5 |
| F-30 | Bombola GPL/metano | Scadenza letta dal cartellino, con foto; nessun calcolo automatico finché non è nota la tipologia | P1 | MVP | Regole di calcolo a confidenza bassa [REG §5] |
| F-31 | Patente e scadenze personali | Scadenza con regola del compleanno, limiti neopatentati, promemoria 120/60/30/7 giorni | P1 | V1 | Richiede una scadenza non legata a un veicolo (profilo conducente): modifica allo schema [REG §6] |
| F-32 | Passaggio di proprietà | Scadenza a 60 giorni dall'autentica, promemoria a 30/45/55/60 giorni | P2 | V1 | [REG §7] |
| F-33 | Calendario `.ics` | Esporta le scadenze come eventi (ridondanza se le notifiche vengono bloccate) | P1 | V1 | |
| F-34 | Avvisi limitazioni ambientali | Promemoria informativo stagionale «verifica le limitazioni nel tuo comune»; mai «puoi/non puoi circolare» | P2 | V2 | Regole locali, confidenza bassa [REG §8] |

### 3.3 Registro: interventi, rifornimenti, spese, livelli, documenti

| ID | Funzione | Cosa fa | Pri | Fase | Note |
|---|---|---|---|---|---|
| F-35 | Interventi e tagliandi | Data, km, officina, tipo, righe (manodopera, ricambi, fluidi), totale lordo, fattura, garanzia, allegati, note | P0 | MVP | Il totale sta sul record: le righe sono facoltative [DAT §1.2] |
| F-36 | «Cosa hai fatto?» | Dopo il salvataggio propone le voci attive da segnare come fatte (un tagliando = olio + filtri); ognuna crea un completamento e riapre il prossimo promemoria | P0 | MVP | [DAT §3.7] |
| F-37 | Cambio olio | Specifica (es. 5W-30 ACEA C3), litri, filtro; intervallo km/mesi «il primo dei due»; evita il doppione se l'olio è già nel tagliando | P0 | MVP | Intervallo indicativo: prevale il libretto [REG §9] |
| F-38 | Officine | Rubrica con telefono, preferite, storico per officina | P1 | MVP | |
| F-39 | Rifornimenti | Litri, prezzo al litro, totale (calcola il terzo), km, pieno/parziale/mancato, due serbatoi (benzina + GPL o metano), consumo pieno-a-pieno, avviso e non blocco se il km non è crescente | P0 | MVP | In meno di 10 secondi; schema da estendere con HVO (sezione 8.2) [FEA §19 M5] |
| F-40 | Ricariche elettriche | kWh, costo, consumo kWh/100 km | P1 | MVP | Stesso modulo di F-39 con unità kWh |
| F-41 | Spese | Categorie (13 di sistema, più personalizzate), importo, data, note, allegato | P0 | MVP | |
| F-42 | Costi e costo al km | Totale per mese, anno e categoria; costo al km con spiegazione del calcolo; grafici con alternativa tabellare; nessun doppione tra interventi, rifornimenti e spese | P0 | MVP | Vista `v_costs` [DAT §1.2] |
| F-43 | Report avanzati | Confronto tra veicoli, costo di possesso a vita, valore residuo inserito | P1 | V1 | |
| F-44 | Controllo livelli | In 3 tocchi: fluido (olio, refrigerante, liquido freni, lavavetri, AdBlue, servosterzo, olio cambio, **pressione gomme**), esito OK/basso/rabboccato/alto, quantità e foto facoltative; promemoria; ultima verifica visibile | P0 | MVP | Non esistono PID standard per questi livelli [OBD §17]; pressione gomme richiede una piccola estensione dello schema (8.2) |
| F-45 | Anomalia consumo olio | Avviso quando la frequenza o la quantità dei rabbocchi cresce | P1 | V1 | [FEA §22] |
| F-46 | Set gomme e DOT | Set estivo, invernale, 4 stagioni (misura, DOT, età, km, deposito, battistrada), un solo set montato, promemoria di età a 5 e 10 anni | P1 | V1 | Schema già pronto [DAT §1.2] |
| F-47 | Documenti | Libretto/Documento Unico, polizza, fatture, multe: foto o PDF, scadenza facoltativa, accesso rapido dalla scheda auto, blocco con F-10 | P0 | MVP | |
| F-48 | Timeline unificata | Per veicolo: rifornimenti, interventi, spese, controlli, snapshot OBD, documenti, con filtri | P0 | MVP | Apprezzata in Fuelio [FEA §23] |
| F-49 | «In caso di incidente» | Scheda con targa, compagnia, numero di polizza, numeri di assistenza e sinistri, condivisibile, disponibile offline | P1 | MVP | Differenziatore D2 [FEA §24] |
| F-50 | PDF «storico per rivendita» | Interventi, costi, scadenze, snapshot OBD, coerenza dei km; versione con QR o hash di integrità | P1 | V1 | Domanda di mercato non misurata [FEA domande aperte] |
| F-51 | Checklist pre-viaggio | Livelli, pressione gomme, luci, codici e tensione via OBD | P2 | V1 | |

### 3.4 Assicurazione

| ID | Funzione | Cosa fa | Pri | Fase | Note |
|---|---|---|---|---|---|
| F-52 | Polizze | RC auto, kasko, furto e incendio, altro: compagnia, agenzia, n. polizza, decorrenza, **scadenza dal certificato**, premio, frequenza di pagamento, classe di merito 1-18, scatola nera, contatti; promemoria a 30/14/7/1/0 giorni | P0 | MVP | La scadenza che conta è quella stampata sul certificato [REG §3.3] |
| F-53 | Rinnovo polizza | Crea la nuova polizza collegata alla precedente; la vecchia passa a «rinnovata»; nessun rinnovo tacito | P0 | MVP | Tacito rinnovo abolito dal 2013 [REG §3.1] |
| F-54 | Rate e pagamenti | Divisione del premio in rate (il resto sulla prima), scadenze con clamp di fine mese, promemoria 7/1/0, «segna pagata» | P1 | MVP | [DAT §3.9] |
| F-55 | Garanzie, massimali, franchigie | Per garanzia: RCA, kasko, furto, incendio, cristalli, eventi naturali, atti vandalici, assistenza, infortuni conducente, tutela legale | P1 | MVP | |

### 3.5 OBD (lettura via adattatore)

| ID | Funzione | Cosa fa | Pri | Fase | Note |
|---|---|---|---|---|---|
| F-56 | Trasporto astratto, simulatore, modalità demo | Interfaccia `ObdTransport` con implementazione simulata (macchina a stati ELM327) e scenari: benzina CAN, diesel, spia accesa, clone difettoso, K-line lenta, auto spenta, disconnessioni | P0 | MVP | Serve a sviluppo su PC, test e App Review [OBD §27, §23] |
| F-57 | Parser OBD/ELM327 | Parser puri: riassemblaggio ISO-TP, bitmap dei PID, stato 0101, DTC, VIN, freeze frame; test su trascrizioni registrate; mai eccezioni su input sporco | P0 | MVP | [OBD §6-§15, §26] |
| F-58 | Collegamento BLE guidato | Wizard: scelta adattatore, permessi in contesto, scansione che mostra i dispositivi con servizi noti (non filtra per nome), selezione delle caratteristiche per proprietà, init AT, ricerca del protocollo, messaggi in italiano | P0 | MVP | Libreria definitiva dopo SP-4 [OBD §4, §5] |
| F-59 | Report di capacità | Dopo il collegamento: protocollo, versione ELM/STN, sospetto clone, PID dichiarati e realmente rispondenti, «cosa leggerà e cosa no»; salvato per VIN; esportabile come file di report **senza VIN né targa** (per beta e supporto, mai inviato automaticamente) | P0 | MVP | Evita il «pago e poi non è supportata» [FEA §15] |
| F-60 | Snapshot diagnostico | VIN, spia MIL, monitor di prontezza, codici memorizzati, pendenti e permanenti, freeze frame, PID chiave, tensione; salvato nella timeline | P0 | MVP | 5-15 s tipici su CAN [OBD §8] |
| F-61 | Dati live essenziali | Giri, velocità, temperatura refrigerante, carico, livello carburante %, tensione; 4-8 Hz; solo ad auto ferma; non persistito se non si preme «Registra» | P0 | MVP | |
| F-62 | Storico codici e descrizioni | Storico per veicolo con stato (attivo, assente, cancellato), prima e ultima rilevazione, km; descrizione italiana curata per i codici più comuni e sistema di appartenenza | P0 | MVP | Descrizioni scritte in proprio, non copiate da SAE J2012 [OBD §15] |
| F-63 | Km e carburante da OBD | Se il PID 01A6 risponde propone di aggiornare i km; altrimenti chiede di digitarli; livello carburante % come valore «letto» | P1 | MVP | Sempre conferma dell'utente [OBD §13] |
| F-64 | Qualità dell'adattatore | Banner (ATI, STI, sonda ATAMC), elenco consigliato, avviso sui cloni; adattatori salvati | P1 | MVP | [OBD §1] |
| F-65 | Sleep e consumo batteria | Disconnessione esplicita, pulsante «Metti in sleep», avviso se la tensione a motore spento è sotto 12,0 V, nota «se l'auto resta ferma più di 2 settimane scollega l'adattatore» | P1 | MVP | [OBD §24] |
| F-66 | Cancellazione codici protetta | Dietro «modalità avanzata»: salva prima codici, freeze frame e stato; doppia conferma con elenco degli effetti; blocca con motore acceso; registra l'azione; mai presentata come modo di superare la revisione | P1 | V1 | Sezione 5.5 [OBD §16] |
| F-67 | Trasporto Wi-Fi | Adattatori Wi-Fi (TCP 192.168.0.10:35000) con avviso «il telefono perde Internet» | P1 | V1 | `react-native-tcp-socket` è un modulo legacy: SP-6 |
| F-68 | Trasporto Bluetooth Classic (Android) | Adattatori ELM327 Classic via SPP | P1 | V1 | **Promovibile a MVP** se l'adattatore dell'utente è Classic e SP-5 riesce; libreria solo in release candidate |
| F-69 | Registrazione sessione | «Registra» con grafici, retention 30 giorni e 50 MB, export CSV | P2 | V1 | [DAT §1.4] |
| F-70 | Trend batteria 12 V | Tensione a riposo, allo spunto, a regime; trend per veicolo; sempre «indicativo» | P1 | V1 | Non è uno stato di salute [OBD §19] |
| F-71 | Stime derivate | Km stimati dalla velocità integrata o dal contatore 0131; ore motore da 011F | P2 | V2 | Etichetta «stimato» [OBD §19] |
| F-72 | Profili per marca | PID Mode 22/UDS per le 3-5 marche più diffuse, solo se validati su auto reali | P2 | V2 | Registro PID proprio [OBD §18] |
| F-73 | OBFCM | Km in vita e consumo reale dal Mode 09 0x17 sulle auto UE dal 2021 | P2 | V2 | Layout non verificato [OBD §14] |
| F-74 | Livello UDS e OBDonUDS | Strato `DiagnosticService` che parla anche UDS | P2 | V2 | L'architettura lo prevede già [OBD §21] |

### 3.6 Crescita e piattaforma

| ID | Funzione | Cosa fa | Pri | Fase | Note |
|---|---|---|---|---|---|
| F-75 | OCR libretto/Documento Unico | Scansione on-device per precompilare targa (A), telaio (E), prima immatricolazione (B), marca (D.1), modello (D.3), cilindrata (P.1), kW (P.2), alimentazione (P.3); stesso motore per scontrini | P1 | V1 | Qualità reale non misurata; wrapper ML Kit con ultimo rilascio a settembre 2025 [FEA §20] |
| F-76 | Widget e scorciatoie | «Prossima scadenza» e «Aggiungi rifornimento» su iOS e Android | P1 | V1 | `expo-widgets` 57.0.23, `react-native-android-widget` 0.22.1 [FEA §16] |
| F-77 | Importatori CSV dei concorrenti | Mappatura colonne per rifornimenti e spese da Drivvo, Fuelio, Simply Auto, aCar, My Car | P1 | V1 | Servono file di esempio reali; domanda 5 |
| F-78 | Backup automatico su cartella scelta | iCloud Drive, Google Drive o altro tramite il selettore di sistema, con rotazione | P1 | V1 | [DAT §5.7] |
| F-79 | Cifratura del backup | AES-GCM con passphrase | P1 | V1 | Librerie non verificate [DAT §5.3] |
| F-80 | Azioni rapide nelle notifiche | «Fatto» e «Rimanda» dalla notifica | P2 | V1 | Esecuzione a app chiusa non affidabile [DAT §4.10] |
| F-81 | Modello Pro | Acquisto una tantum con ripristino degli acquisti | P1 | V1 | Libreria di acquisto non ricercata: [DA VERIFICARE] |
| F-82 | Protezione avanzata del database | SQLCipher con chiave in secure store | P2 | V2 | [DAT §6.4] |
| F-83 | Famiglia e sincronizzazione E2E | Sync per riga con cifratura end-to-end | P2 | V2 | Solo se emerge domanda; ricerca dedicata necessaria [DAT §5.7] |
| F-84 | Prezzi carburante MIMIT | Prezzi ufficiali (open data, IODL 2.0) con filtri HVO, GPL, metano | P2 | V2 | File voluminosi: serve pre-elaborazione [FEA §18] |
| F-85 | CarPlay e Android Auto | Cruscotto in sola lettura | P2 | V2 | |

### 3.7 Conteggi

| Priorità | MVP | V1 | V2 | Totale |
|---|---|---|---|---|
| P0 | 44 | 0 | 0 | 44 |
| P1 | 12 | 16 | 0 | 28 |
| P2 | 0 | 4 | 9 | 13 |
| Totale | 56 | 20 | 9 | 85 |

*(Le P0 sono: F-01..F-09, F-11..F-16, F-18..F-28, F-35..F-37, F-39, F-41, F-42, F-44, F-47, F-48, F-52, F-53, F-56..F-62. Conteggi verificati con uno script sulla tabella.)*

### 3.8 Esclusioni dichiarate (non si fanno, e perché)

| ID | Esclusione | Motivo |
|---|---|---|
| W-01 | Coding e adattamenti della centralina | Principale fonte di recensioni a 1 stella (Car Scanner, OBD Fusion, Carly); rischio di danni e responsabilità; manutenzione per modello [FEA §21] |
| W-02 | Reset service, rigenerazione DPF/FAP, freno di stazionamento elettrico | Come W-01 |
| W-03 | Pubblicità, vendita o condivisione di dati e posizione | Causa della rivolta contro Drivvo; contraddice P-01 |
| W-04 | Account obbligatorio e cloud proprietario di default | Contraddice D-02 |
| W-05 | Ricerca per targa con scraping di servizi pubblici | Rischio legale e di privacy, dipendenza da terzi |
| W-06 | Preventivi assicurativi con lead generation | Conflitto di interessi con l'utente |
| W-07 | Bluetooth Classic su iOS | Richiede hardware certificato MFi |
| W-08 | Flotte e funzioni B2B | Già presidiate da altri; fuori target |
| W-09 | Versione web come prodotto | Il web serve solo allo sviluppo su PC |
| W-10 | Calcolo dell'importo del bollo e delle sanzioni | Troppe variabili regionali (D-09) |
| W-11 | Intervalli di manutenzione per modello | Non esiste una fonte aperta affidabile [FEA §20 S9] |
| W-12 | Codici di ABS, airbag e altre centraline | Servono servizi UDS/KWP proprietari di marca [OBD §15]: solo V2 con profili validati |
| W-13 | Consigli di guida con spie accese o dichiarazioni «puoi/non puoi circolare» | Responsabilità; usare «potrebbero applicarsi limitazioni» [REG §8] |
| W-14 | Connessione OBD in background (foreground service, `bluetooth-central`) | Più revisione store e più consumo; sessioni solo in primo piano [OBD §22, §23] |
| W-15 | SQLCipher e sincronizzazione nell'MVP | D-11 e D-12 |

## 4. Tracciabilità: dalla richiesta dell'utente alle funzionalità

Richiesta originale (italiano): *«un app perfetta per la gestione delle proprie auto, dove puoi collegare le tue auto tramite bluetooth e scaricare tutte le informazioni, dove puoi aggiungere tagliandi fatti, assicurazione, scadenze, cambio olio, livello e tutto»*.

### 4.1 Richiesta → funzionalità

| # | Frase della richiesta | Funzionalità | Fase | Cosa NON copre (onestà) |
|---|---|---|---|---|
| 1 | «un'app perfetta per la gestione delle proprie auto» | F-01, F-02, F-13, F-14, F-15, F-16, F-48; qualità misurata da NFR-01..NFR-15 e AC-01..AC-14 | MVP | «Perfetta» non è verificabile: vale il rispetto dei criteri delle sezioni 10 e 11 |
| 2 | «collegare le tue auto tramite bluetooth» | F-56 (simulatore e demo), F-57 (parser), F-58 (collegamento BLE), F-59 (report di capacità), F-64 (qualità adattatore); poi F-68 (Classic Android) e F-67 (Wi-Fi) | MVP (BLE); V1 (Classic, Wi-Fi) | Le auto non hanno Bluetooth utilizzabile da un'app: serve un adattatore OBD-II/ELM327. Su iOS i Bluetooth Classic economici **non** funzionano (serve BLE o Wi-Fi). Auto con OBDonUDS o autenticazione dello strumento potrebbero non rispondere (R-12) |
| 3 | «scaricare tutte le informazioni» | F-60 (snapshot), F-61 (dati live), F-62 (storico codici), F-63 (km e carburante), F-59 (cosa risponde l'auto), F-69 (registrazione) | MVP; F-69 in V1 | Solo ciò che l'OBD standard espone: vedi la tabella 5.1. Livello olio, vita olio, intervalli di service, pressione gomme, usura freni, stato batteria 12 V, SoC/SoH delle elettriche **non** sono disponibili senza profili di marca (V2) |
| 4 | «aggiungere tagliandi fatti» | F-35 (interventi), F-36 («Cosa hai fatto?»), F-37 (cambio olio), F-38 (officine), F-04 (allegati), F-47 (documenti), F-48 (timeline), F-50 (PDF rivendita) | MVP; F-50 in V1 | — |
| 5 | «assicurazione» | F-52 (polizze), F-53 (rinnovo), F-54 (rate), F-55 (garanzie), F-49 («In caso di incidente»), F-47 (documenti) | MVP | Non si fanno preventivi né confronti (W-06); non si legge l'attestato di rischio online (si può solo allegare il PDF) |
| 6 | «scadenze» | F-19 (motore), F-20 (wizard), F-21 (revisione), F-22 (bollo), F-23 (personalizzate), F-24 (semafori), F-25 (fatto/rimanda), F-26 (previsione km), F-27 (notifiche), F-28 (verifica notifiche), F-29 (gomme), F-30 (bombole); poi F-31 (patente), F-32 (passaggio di proprietà), F-33 (.ics) | MVP; V1 | Le regole sono promemoria informativi, non consulenza legale; ogni scadenza si può sovrascrivere con la data del documento ufficiale |
| 7 | «cambio olio» | F-37 (registrazione e specifica), F-19 e F-20 (intervallo «il primo dei due»), F-44 (controllo livello olio), F-45 (consumo anomalo, V1) | MVP; F-45 in V1 | L'OBD non legge livello né vita dell'olio: il livello è un controllo manuale guidato; la scadenza è per km e mesi |
| 8 | «livello» | Carburante: F-39 (rifornimenti) e F-63/F-61 (livello % letto se il PID 012F risponde). Liquidi (olio, refrigerante, freni, lavavetri, AdBlue) e pressione gomme: F-44 con promemoria. Temperature e tensione: F-61, F-65, F-70 | MVP; F-70 in V1 | Il livello carburante via OBD può non essere esposto (alcune auto europee richiedono comandi di marca) [OBD §13] |
| 9 | «e tutto» | Rifornimenti e consumi F-39/F-40; spese e costo al km F-41/F-42; gomme F-29/F-46; documenti F-47; backup ed export F-06..F-08; storico per rivendita F-50; patente F-31; famiglia F-83 (V2) | MVP, V1, V2 | «Tutto» si traduce nell'elenco chiuso della sezione 3; l'unico «tutto» aperto è «tutto ciò che la tua auto espone via OBD standard» |

### 4.2 Funzionalità non richieste ma indispensabili

Sono le condizioni di fiducia che le recensioni dei concorrenti indicano come cause di abbandono.

| Funzionalità | Perché serve |
|---|---|
| F-06, F-07, F-08, F-09, F-05 (backup, ripristino, export, cancellazione, cestino) | Perdita di dati e dati «in ostaggio» sono tra le lamentele più frequenti [FEA §13] |
| F-27, F-28 (notifiche affidabili e verifica) | «I promemoria non arrivano» è un difetto citato su Drivvo, My Car, MyPeugeot [FEA §27] |
| F-10, F-18 (blocco app, informative) | Libretto e polizza contengono dati personali; le informative sono obbligatorie negli store |
| F-15, F-16 (accessibilità, italiano) | Pubblico italiano ampio e non solo giovane; traduzioni scadenti sono una lamentela [FEA §26] |
| F-12, F-17 (onboarding, auto demo) | Valore dal primo minuto (P-02) |

## 5. OBD: cosa si può e cosa non si può ottenere

Questa sezione è il contratto di onestà con l'utente. Tutto ciò che l'app mostra o promette sull'OBD deve stare dentro queste tabelle. Fonti: [OBD §10-§19], verificate da uno scettico indipendente (formule dei PID ricalcolate: tutte esatte).

### 5.1 Tabella onesta

**A. Dati che l'OBD standard espone (se la centralina li supporta: si interroga sempre la bitmap dei PID e si prova la risposta)**

| Informazione | Come si legge | Disponibilità | Cosa fa MyGarage | Confidenza |
|---|---|---|---|---|
| VIN (telaio) | Mode 09 PID 02 (`0902`) | Auto recenti sì; alcune vecchie no | Lo propone come chiave dell'auto con conferma «È la tua auto?»; se manca, inserimento manuale (OCR in V1) | alta |
| Spia motore (MIL) e numero di codici | PID `0101` | Sì | «Spia accesa, 2 codici» | alta |
| Codici guasto memorizzati, pendenti, permanenti | Mode 03, 07, 0A | Sì, **solo centraline motore/cambio (emissioni)** | Codice, sistema, descrizione italiana, storico | alta |
| Freeze frame (condizioni al momento del guasto) | Mode 02 (letto *prima* di qualsiasi cancellazione) | Sì, se esiste un codice | Salvato insieme al codice | alta |
| Monitor di prontezza | PID `0101` byte B, C, D | Sì | «Pronto» / «Non ancora pronto» per monitor | media-alta (ordine dei bit da confermare su auto reale, SP-8) |
| Temperatura refrigerante | PID `0105`: A − 40 °C | Sì | Valore live | alta |
| Giri, velocità, carico motore | PID `010C` ((256A+B)/4), `010D`, `0104` | Sì | Valori live | alta |
| Temperatura aria aspirata e ambiente | PID `010F`, `0146` | Spesso | Valore live se risponde | alta |
| Tensione del modulo di controllo | PID `0142`: (256A+B)/1000 V; in alternativa `ATRV` (tensione al pin 16 misurata dall'adattatore) | Spesso (`0142`); `ATRV` quasi sempre | Valore live; nell'MVP non è uno «stato batteria» | alta |
| **Livello carburante %** | PID `012F`: A·100/255 | **Spesso ma non garantito**: alcune auto europee richiedono comandi di marca o non lo espongono | «Letto dall'auto» se risponde; altrimenti si usa il registro rifornimenti | media |
| Tipo carburante, standard OBD del veicolo | PID `0151`, `011C` | Spesso | Abilita o nasconde funzioni (es. nessun livello carburante su elettrica) | media |
| Tempo dall'avviamento; km dalla cancellazione codici; km con spia accesa | PID `011F`, `0131`, `0121` | Sì ma si azzerano con la cancellazione | Base per le stime (F-71, V2) | media |
| **Chilometraggio (odometro)** | PID `01A6`: (A·2²⁴+B·2¹⁶+C·2⁸+D)/10 km | **Opzionale**: atteso sulle auto certificate CARB dal modello 2019; per le auto europee non risulta un obbligo | Si prova sempre; se risponde propone di aggiornare i km; se non risponde chiede all'utente | media (formulazione corretta dalla verifica) |
| Temperatura olio motore | PID `015C`: A − 40 °C | Limitata (alcune marche, es. BMW, non lo espongono) | Mostrata solo se dichiarata *e* risponde | media |
| Consumo istantaneo | PID `015E` | Raro | Non usato nell'MVP | media |

**B. Dati che l'OBD standard NON espone (non vanno mai promessi)**

| Informazione | Perché | Cosa fa MyGarage |
|---|---|---|
| Livello dell'olio (misura) e vita residua dell'olio in % | Nessun PID standard; sono stime proprietarie del costruttore | **Controllo manuale guidato** (F-44) con promemoria; scadenza dell'olio per km e mesi (F-37) |
| Intervallo di service («tagliando tra X km») | Contatore proprietario | Scadenze per km e mesi inserite dall'utente (F-19, F-20) |
| Pressione e temperatura dei pneumatici (TPMS) | Dato sulla rete di carrozzeria, proprietario; si legge sul cruscotto | Controllo manuale della pressione (F-44) |
| Usura delle pastiglie dei freni | Spesso solo un contatto on/off | Promemoria «controllo freni» a ogni tagliando |
| Salute della batteria 12 V (SoH) | BMS/IBS proprietari | Trend di tensione «indicativo» (F-70, V1), mai «stato di salute» |
| Livello di liquido freni, refrigerante, lavavetri, AdBlue | Nessun PID standard | Controlli manuali (F-44) |
| Codici di ABS, airbag, carrozzeria, clima | Servono servizi UDS/KWP con indirizzi di marca | Esclusi (W-12); V2 con profili validati |
| SoC/SoH della batteria di trazione di elettriche e ibride | Non esiste uno standard (PID `015B` e `019A` sono opzionali e poco documentati) | Solo dati standard (D-15); profili di marca in V2 |
| Coding, reset service, rigenerazione DPF, freno di stazionamento elettrico | Fuori standard; funzioni costruttore | Esclusi (W-01, W-02) |
| Tesla | Non usa l'OBD-II in senso tradizionale | Non supportata |

**C. Dati derivabili (sempre etichettati «stimato»)**

| Stima | Metodo | Limite |
|---|---|---|
| Km percorsi | Integrazione della velocità (`010D`) nel tempo (errore tipico 1-3%, metodo non verificato) o differenza del contatore `0131` | Si riancora ai km reali inseriti; mai scritta come lettura valida senza conferma |
| Ore motore | Somma di `011F` per sessione | Solo se l'app è collegata |
| Uso severo (viaggi brevi, motore mai a regime) | Durata sessioni e temperatura refrigerante | Suggerisce di accorciare l'intervallo; non cambia le scadenze da solo |
| Trend batteria | `ATRV` a riposo, allo spunto, a regime | Latenza BLE 200-300 ms; soglie indicative |

### 5.2 Provenienza dei dati

Ogni valore mostrato porta un'etichetta **sempre visibile e accessibile ai lettori di schermo**:

| Etichetta | Significato | Regola |
|---|---|---|
| **Letto dall'auto** | Risposta diretta dell'ECU in una sessione | Mostra data e ora della sessione |
| **Stimato** | Calcolato dall'app | Mai scritto nel registro dei km come lettura valida senza conferma; si riancora al primo km reale |
| **Inserito da te** | Digitato dall'utente | Prevale su ogni stima |

### 5.3 Piattaforme, trasporti e adattatori

| Trasporto | iOS | Android | Fase | Note |
|---|---|---|---|---|
| Bluetooth Low Energy (BLE) | Sì | Sì | **MVP** | Baseline cross-platform. Non esiste un UUID GATT unico: si sceglie per proprietà (notify, write) provando una lista nota (servizio FFF0 con FFF1 notify e FFF2 write su OBDLink CX; 18F0/2AF0/2AF1 su Vgate iCar Pro BLE; FFE0/FFE1 stile HM-10; Nordic UART) |
| Wi-Fi (TCP) | Sì | Sì | V1 | Il telefono lascia la rete di casa e perde Internet; su iOS serve il permesso «Rete locale» [DA VERIFICARE su fonte Apple primaria] |
| Bluetooth Classic (SPP) | **No** (serve hardware MFi: OBDLink MX+, vLinker FS/MS) | Sì | V1 (promovibile) | Circa il 95% degli utenti Android di Car Scanner usa Classic: se l'adattatore dell'utente è Classic questa funzione sale in MVP (domanda 3) |

**Adattatori.** Si accetta qualsiasi adattatore compatibile ELM327; la stringa di versione non è affidabile (i cloni «v1.5» e «v2.1» sono quasi sempre firmware v1.4 copiato: non esiste una versione 1.5). Il banner di qualità dell'app si basa su `ATI`, `STI` e su una sonda (`ATAMC` risponde `?` sui firmware precedenti alla 2.0). Indicazioni di terzi (Car Scanner, **non provate da noi**, confidenza media) per la lista consigliata: OBDLink CX (BLE), OBDLink MX+ (Classic+MFi), vLinker MC+/MS/FS, Vgate iCar Pro 2S (BLE), Car2LS ScanX; da evitare gli adattatori «mini», sotto i 10 USD, con MAC che inizia per 11:22:33 o 00:00:00 [OBD §1]. La lista consigliata di MyGarage si pubblica **solo dopo le prove** con adattatori reali (Fase 2).

### 5.4 Che cosa si dice all'utente

**Si può dire:** «Leggi i codici guasto del motore, la spia, il VIN e i dati live standard con la tua auto.» · «Tagliandi, assicurazione, scadenze, cambio olio e livelli si registrano a mano e l'app ti avvisa.» · «Prima di collegare, vedi cosa legge la tua auto.»

**Non si deve dire:** «Legge tutto», «legge il livello dell'olio», «legge la pressione delle gomme», «stato di salute della batteria», «funziona con tutte le auto», «compila da sola il libretto». Nelle schede store: nessun claim per marca; nessun confronto con i concorrenti senza fonte.

In ogni scheda veicolo compare la checklist **«Dati letti dalla tua auto / non disponibili su questa auto»**, costruita dal report di capacità (F-59).

### 5.5 Sicurezza, cancellazione dei codici e revisione italiana

La cancellazione (Mode 04) azzera il contatore dei codici, i codici, il freeze frame, il codice che l'ha generato, i dati delle sonde O2 e le informazioni dei Mode 06/07; **non** cancella i codici permanenti (Mode 0A); su alcune auto richiede quadro acceso e motore spento. È noto da pratica degli strumenti, ma non dal datasheet ELM327, che i monitor di prontezza tornano «non completi» [OBD §16: [DA VERIFICARE] su auto reale con `0101` prima e dopo, SP-8].

Contesto italiano (corretto dalla verifica): con il Decreto Dirigenziale 11-08-2023 e la circolare MIT 33287 del 07-11-2023, **i centri di revisione devono dotarsi dello scantool OBD entro il 24-02-2024**; per i veicoli M1, M2, N1 Euro 5/6 immatricolati dal 1-9-2009 la revisione controlla la spia MIL (accesa a quadro acceso e motore spento, spenta a motore avviato) e legge i dati via scantool; l'esito è irregolare se la spia risulta accesa. Se lo strumento non comunica entro 120 s il test è «incompleto con esito regolare». Cancellare i codici non risolve il guasto: la spia si riaccende se il difetto è presente [REG §1.2 punto 7; OBD §16].

Requisiti per F-66 (V1): (1) funzione disattivata finché non si abilita la «modalità avanzata»; (2) prima di cancellare, salvataggio automatico in storico di codici, freeze frame e stato `0101`; (3) doppia conferma con il testo: *«Cancella i codici, il freeze frame e i dati dei test e azzera i monitor di prontezza; i codici permanenti restano; l'auto potrebbe non risultare pronta per la revisione. Il guasto non viene riparato.»*; (4) blocco se i giri sono maggiori di zero o la tensione è bassa; (5) log con data e ora; (6) mai presentata come modo per superare la revisione.

### 5.6 Rischi tecnici e normativi futuri (non bloccanti oggi)

| Tema | Stato | Effetto |
|---|---|---|
| OBDonUDS (SAE J1979-2/-3) | Obbligatorio negli USA dal modello 2027 (date CARB: [DA VERIFICARE]); **per l'UE non è verificato che sia imposto** | I veicoli J1979-2 non rispondono ai protocolli classici: un ELM327 che invia solo `01 00` non funziona. Previsto lo strato astratto `DiagnosticService` (F-74) |
| Regolamento delegato UE 2026/699 | In vigore dal 2026-06-23, scadenze 2026-12-23, 2027-06-23, 2028-06-23: i costruttori possono richiedere l'autenticazione degli strumenti diagnostici | L'impatto sul Mode 01/03 generico **non è chiarito** dalla fonte [OBD §21] |
| Euro 7 (Reg. UE 2024/1257) | Applicazione dal 2026-11-29 ai nuovi tipi e dal 2027-11-29 a tutti i nuovi veicoli | Auto nuove potrebbero non essere leggibili da ELM327 generici |

Conseguenza di prodotto: la scheda di compatibilità e il report di capacità dichiarano esplicitamente «questa auto non risponde» senza dare la colpa all'utente.

**Fonti (URL) e confidenza:** https://www.elmelectronics.com/wp-content/uploads/2016/07/ELM327DS.pdf · https://en.wikipedia.org/wiki/OBD-II_PIDs · https://www.csselectronics.com/pages/obd2-pid-table-on-board-diagnostics-j1979 · https://support.obdlink.com/support/solutions/articles/43000746707-obdlink-cx-adapter-notes · https://www.carscanner.info/choosing-obdii-adapter/ · https://revisione.dekra.it/sites/default/files/Il%20nuovo%20controllo%20Scantool%20OBD.pdf · https://www.noerr.com/en/insights/delegated-regulation-eu-2026-699-sets-out-new-guidelines-for-secure-gateways-obd-access-and-rmi · https://oeil.europarl.europa.eu/oeil/en/document-summary?id=1784743 · https://github.com/Anush-aj/obfcm. Confidenza **alta** per formule dei PID, decodifica dei DTC, VIN, sequenza di init e stringhe di errore (ricalcolate con script indipendenti); **media** per la disponibilità sui singoli veicoli e sulle date normative; **bassa** per OBFCM e per gli UUID GATT diversi da OBDLink.

## 6. Schermate e flussi

### 6.1 Navigazione

Barra in basso con **4 schede**, azione rapida «+» sempre raggiungibile con una mano e un **selettore d'auto** nell'intestazione («Tutte le auto» oppure una singola auto) che filtra «Oggi» e «Registro».

| Scheda | Contenuto | Rotta (expo-router) |
|---|---|---|
| **Oggi** | Semafori, prossima scadenza, «Da fare», banner | `(tabs)/index` |
| **Garage** | Elenco auto → scheda auto (Panoramica, Scadenze, Registro, Documenti, Assicurazioni, OBD, Costi) | `(tabs)/garage`, `auto/[id]/...` |
| **Registro** | Timeline unificata con filtri e ricerca | `(tabs)/registro` |
| **Impostazioni** | Notifiche, backup e dati, privacy, adattatori, informazioni | `(tabs)/impostazioni` |

Le schermate in `app/` sono sottili (solo composizione e navigazione); la logica sta in `src/` (sezione 8.6). Il pulsante «+» apre un foglio (S-15) con: Rifornimento, Intervento, Spesa, Controllo livello, Aggiorna km, Documento, Scadenza.

### 6.2 Elenco delle schermate

| ID | Schermata | Scopo | Funzionalità |
|---|---|---|---|
| S-01 | Blocco app | Sblocco con biometria o codice del dispositivo; schermata neutra nel selettore app | F-10 |
| S-02 | Benvenuto | Tre schermate brevi: «I tuoi dati restano tuoi», «Le scadenze non si perdono», «Se vuoi, collega l'auto»; pulsanti «Aggiungi la tua auto» e «Prova con un'auto di esempio» | F-12, F-17 |
| S-03 | Aggiungi/modifica auto | Dati essenziali in due passi (identità, alimentazione e km) | F-01 |
| S-04 | Imposta le scadenze | Wizard del catalogo | F-20 |
| S-05 | Attiva gli avvisi | Spiega cosa arriverà prima del dialogo di sistema | F-27 |
| S-10 | Oggi | Dashboard | F-13, F-24 |
| S-11 | Garage | Elenco auto con semaforo, km, prossima scadenza | F-01 |
| S-12 | Scheda auto | Riassunto e accessi | F-02 |
| S-13 | Registro | Timeline unificata con filtri per tipo e periodo | F-48 |
| S-14 | Dettaglio evento | Intervento, rifornimento, spesa, controllo, snapshot OBD, con allegati e modifica | F-35, F-39, F-41, F-44, F-60 |
| S-15 | Azione rapida | Foglio delle azioni di inserimento | F-14 |
| S-20 | Nuovo intervento | Modulo guidato | F-35, F-37 |
| S-21 | «Cosa hai fatto?» | Selezione delle voci da segnare come fatte | F-36 |
| S-22 | Rifornimento o ricarica | Inserimento in meno di 10 secondi | F-39, F-40 |
| S-23 | Spesa | Modulo semplice | F-41 |
| S-24 | Controllo livelli | Elenco fluidi con ultima verifica e foglio di registrazione a 3 tocchi | F-44 |
| S-25 | Aggiorna km | Lettura manuale con avviso di coerenza | F-03 |
| S-26 | Documenti | Elenco per categoria, ricerca | F-47 |
| S-27 | Documento | Visualizzazione, aggiunta (foto, galleria, PDF), scadenza facoltativa | F-47, F-04 |
| S-30 | Scadenze dell'auto | Elenco per stato (scadute, in arrivo, in regola, da configurare) | F-19, F-24 |
| S-31 | Dettaglio scadenza | Regola, base di calcolo, storico, «Fatto», «Rimanda», «Salta», modifica | F-19, F-25, F-26 |
| S-32 | Nuova scadenza | Scadenza personalizzata con ricorrenza | F-23 |
| S-40 | Assicurazioni | Elenco polizze dell'auto con stato | F-52 |
| S-41 | Dettaglio polizza | Dati, rate, garanzie, allegati, «Rinnova» | F-52..F-55 |
| S-42 | Nuova/modifica polizza | Modulo guidato | F-52 |
| S-43 | In caso di incidente | Scheda condivisibile e offline | F-49 |
| S-50 | OBD dell'auto | Stato dell'ultimo collegamento, adattatore preferito, «Collega», «Prova senza adattatore», storico snapshot e codici | F-56..F-65 |
| S-51 | Che adattatore hai? | Scelta del tipo di adattatore con avvisi per piattaforma | F-58 |
| S-52 | Permessi Bluetooth | Spiegazione prima del dialogo di sistema; percorso «Apri impostazioni» se negato | F-58 |
| S-53 | Scansione | Elenco dispositivi con «probabile adattatore OBD» evidenziato | F-58 |
| S-54 | Connessione | Avanzamento a passi con messaggi in italiano | F-58 |
| S-55 | Report di capacità | Cosa risponde l'auto, qualità dell'adattatore, checklist «letti / non disponibili» | F-59, F-64 |
| S-56 | Risultato snapshot | Spia, codici, prontezza, dati principali, tensione | F-60 |
| S-57 | Dettaglio codice | Codice, sistema, descrizione, freeze frame, storico | F-62 |
| S-58 | Dati live | Valori grandi, solo ad auto ferma | F-61 |
| S-59 | Modalità demo | Scelta dello scenario simulato | F-56 |
| S-60 | Costi | Totali per periodo e categoria, costo al km, grafici e tabella | F-42 |
| S-70 | Impostazioni | Elenco | F-11 |
| S-71 | Notifiche | Permesso, ora, riservatezza del testo, «Verifica notifiche» | F-27, F-28 |
| S-72 | Backup e dati | Esporta, importa, esporta CSV, ultimo backup | F-06..F-08 |
| S-73 | Privacy e cancellazione | Cosa si salva, informativa, «Cancella tutti i dati» | F-09, F-18 |
| S-74 | Informazioni e stato del progetto | Versione, data ultimo aggiornamento, contatto, licenze | F-18 |
| S-75 | Adattatori salvati | Elenco, rinomina, dimentica | F-64 |
| S-76 | Cancella codici *(V1)* | Procedura protetta con doppia conferma | F-66 |

### 6.3 Flussi

#### 6.3.1 Onboarding (obiettivo: dalla prima apertura alla prima scadenza in meno di 2 minuti)

1. **S-02 Benvenuto**: tre schermate saltabili. Nessun account, nessun permesso richiesto qui.
2. **Aggiungi la tua auto** (S-03): *passo 1* soprannome (es. «Panda di Marco»), marca, modello, anno; targa e VIN facoltativi; *passo 2* alimentazione (benzina, gasolio, GPL, metano, elettrica; con «doppia alimentazione» per benzina+GPL o benzina+metano), km attuali, data di prima immatricolazione (serve a revisione e bollo). In alternativa **«Prova con un'auto di esempio»** (F-17).
3. **Imposta le scadenze** (S-04): vedi 6.3.3. Se l'utente salta, resta l'invito nella scheda «Oggi».
4. **Attiva gli avvisi** (S-05): compare *solo dopo* che esiste almeno una scadenza. Testo: «Vuoi che ti avvisi prima delle scadenze? Arriveranno sul tuo telefono, senza pubblicità e senza account.» Poi il dialogo di sistema. Se rifiuta, l'app resta pienamente usabile e «Oggi» mostra il banner «Senza avvisi potresti perdere una scadenza».
5. **Oggi** (S-10) mostra subito i semafori.
6. Il permesso Bluetooth **non** viene chiesto in onboarding: solo al tocco su «Collega auto» (6.3.5).

*Casi limite:* auto senza targa (consentito); alimentazione GPL o metano → compaiono la bombola e il controllo impianto nel wizard; auto elettrica → nessun cambio olio né candele, compare «Controllo veicolo elettrico»; auto con più di 4 anni → si chiede la data dell'ultima revisione; con meno di 4 anni → prima revisione calcolata dall'immatricolazione.

#### 6.3.2 Aggiunta e modifica auto

- Campi obbligatori: marca, modello, alimentazione primaria. Tutto il resto è facoltativo (P-02, minimizzazione).
- VIN: se inserito si normalizza (maiuscolo, senza spazi, alfabeto senza I, O, Q; il check digit **non** si impone in Europa [OBD §14]). Una targa già presente in un'altra auto non eliminata dà errore comprensibile («Questa targa è già nel tuo garage»).
- Potenza kW ed Euro servono ad avvisi informativi (es. esenzione bollo 2027, limitazioni): mai usate per calcolare importi.
- Stato dell'auto: attiva, venduta, rottamata, archiviata. Un'auto non attiva non genera promemoria né notifiche.
- Eliminazione: conferma con il nome dell'auto e invio nel cestino per 30 giorni (F-05).
- *V1:* precompilazione da OCR del libretto (F-75) e dal VIN letto via OBD (conferma «È la tua auto?»). **La marca e il modello non si ricavano dal VIN**: la decodifica del VIN per l'Europa non ha una fonte gratuita verificata.

#### 6.3.3 «Imposta le scadenze» (wizard)

1. Il catalogo di 27 voci (sezione 7.1) viene filtrato per alimentazione e proposto con le sole voci «attive di default» pre-selezionate; l'utente può aggiungerne altre.
2. Per ogni voce selezionata si chiede **«Quando l'hai fatto l'ultima volta?»** con tre risposte: *data e km* / *non lo so* / *mai fatto*. Con «non lo so» **non si inventa nulla**: la voce resta «Da configurare» e non produce notifiche (principio I3 del motore).
3. Voci speciali: **revisione** (auto con meno di 4 anni: base = prima immatricolazione; altrimenti si chiede la data dell'ultima revisione, anche dalla ricevuta); **bollo** (si chiede il *mese di pagamento*, con spiegazione e link al calcolo ACI); **bombola** (data dal cartellino); **gomme stagionali** (spente di default).
4. **RC auto non è un template**: si crea dalla polizza (6.3.7); il wizard propone «Aggiungi l'assicurazione».
5. Al termine: riepilogo con semaforo per voce e prossimo passo («Aggiungi l'assicurazione», «Collega l'auto»).

#### 6.3.4 Dashboard «Oggi» e semafori

**Stati e colori** (sempre con icona *e* testo; mai solo colore):

| Stato | Quando | Colore e testo | Esempio di testo |
|---|---|---|---|
| Da configurare | Mancano dati (principio I3) | Grigio | «Da configurare: quando l'hai fatto l'ultima volta?» |
| In regola | Oltre le soglie | Verde | «In regola · scade il 30/11/2027» |
| In arrivo | `giorni_rimasti ≤ soon_days` oppure `km_rimasti ≤ soon_km` | Giallo | «In arrivo · tra 12 giorni» / «tra circa 900 km (stima)» |
| Scade oggi | `giorni_rimasti = 0` | **Rosso** | «Scade oggi» |
| Scaduta | `giorni_rimasti < 0` oppure km raggiunti | Rosso | «Scaduta da 3 giorni» / «Probabilmente scaduta (stima)» |

*Nota di implementazione:* nel motore «scade oggi» è `soon` (non scaduta) [DAT §3.5]; la UI lo mostra in rosso perché è l'ultimo giorno utile. Lo stato **non si salva**: si calcola da `oggi` e dai km.

**Contenuto di «Oggi» dall'alto:**
1. Banner (al massimo due, in quest'ordine): avvisi spenti → «Aggiorna i km» (ultima lettura oltre 30 giorni con scadenza a km entro 90) → «Fai un backup» (30 giorni e almeno 5 modifiche).
2. **Scheda «Prossima scadenza»**: la voce più urgente (scadute per prime, poi per data effettiva), con pulsanti «Fatto» e «Rimanda».
3. **Semafori per categoria** (Legale, Assicurazione, Manutenzione, Controlli, Gomme): contano le voci per stato; il tocco apre l'elenco filtrato. Lo stato della categoria è il *peggiore* tra le sue voci.
4. **Da fare**: fino a 50 promemoria aperti non rimandati, ordinati per scadute, poi in arrivo, poi per data.
5. Se esiste un solo veicolo il selettore d'auto è nascosto; stati vuoti con un'azione («Aggiungi la tua auto», «Imposta le scadenze»).

#### 6.3.5 Collegamento OBD (con modalità demo)

*Ingressi:* scheda auto → OBD; scheda «Oggi» («Collega l'auto» se l'auto non ha ancora un adattatore); mai in onboarding.

1. **S-50 OBD dell'auto.** Riquadro «Cosa legge l'auto» (sintesi di 5.4) e due pulsanti: **«Collega l'adattatore»** e **«Prova senza adattatore (demo)»**.
2. **S-51 «Che adattatore hai?»** Opzioni: *Bluetooth BLE* · *Wi-Fi* (V1) · *Bluetooth Classic* (solo Android; V1) · *Non lo so* (guida con foto e consigli: i BLE si chiamano spesso «OBDII», «obd2» o col nome del marchio). Su iPhone, scegliendo Classic o «Non lo so» compare: *«Su iPhone gli adattatori Bluetooth Classic non funzionano: serve un adattatore BLE o Wi-Fi.»*
3. **S-52 Permessi.** Spiega *prima* del dialogo di sistema. Android 12+: «Dispositivi nelle vicinanze» (`BLUETOOTH_SCAN` con `neverForLocation`, `BLUETOOTH_CONNECT`); Android 11 e precedenti: posizione, richiesta solo per la scansione (con il pulsante di sistema Posizione attivo); iOS: testo del sistema *«MyGarage usa il Bluetooth per leggere i dati dall'adattatore OBD-II della tua auto.»* Se negato: «Apri impostazioni» e ritorno al flusso. Se il Bluetooth del telefono è spento: invito ad attivarlo.
4. **S-53 Scansione.** Istruzioni: *«Inserisci l'adattatore nella presa OBD (di solito sotto il volante) e gira la chiave su quadro acceso. Non serve avviare il motore.»* Elenco di **tutti** i dispositivi con servizi noti («Probabile adattatore OBD» in evidenza), non filtrato per nome. Nota per OBDLink CX: l'abbinamento è abilitato nei primi 5 minuti dall'alimentazione [OBD §5].
5. **S-54 Connessione.** Passi con testo semplice e barra di avanzamento: «Mi collego all'adattatore…» → «Adattatore trovato (ELM327 v2.1)» → «Cerco il protocollo dell'auto… (fino a 15 secondi)» → «Auto trovata (CAN 11 bit 500 kbit/s)». Il ripiego K-line può richiedere fino a 8 s.
6. **S-55 Report di capacità.** VIN con conferma («È la tua auto? ZFA… · Panda»), protocollo, adattatore e banner di qualità (clone sospetto), **PID dichiarati e realmente rispondenti**, checklist *letti / non disponibili* (carburante %, temperatura, tensione, km, temperatura olio; sempre «non disponibili»: livello olio, pressione gomme, usura freni, stato batteria). Il profilo si salva per VIN (cache che si invalida se cambiano protocollo o ECU).
7. **S-56 Snapshot** (5-15 s): «Leggo la spia e i codici…» → «Leggo i dati principali…». Risultato: card MIL e numero codici, elenco codici (storico), readiness, valori, tensione. L'**evento viene salvato in timeline** e si può eliminare. Azioni: «Vedi dati live», «Aggiorna i km» (se `01A6` risponde, con conferma), «Disconnetti» (e «Metti in sleep»).
8. **S-57 Dettaglio codice**: codice, sistema (motore, telaio, carrozzeria, rete), descrizione italiana, quando è stato visto, freeze frame, stato. Testo fisso: *«Un codice non indica da solo il pezzo guasto: fai verificare l'auto da un'officina.»* Nessun consiglio su come guidare.
9. **S-58 Dati live**: valori grandi (giri, velocità, temperatura refrigerante, carico, carburante %, tensione), 4-8 Hz, schermo sempre acceso, banner *«Usa questa schermata solo ad auto ferma.»*; nessuna interazione complessa.
10. **Fine sessione:** disconnessione esplicita; in MVP la connessione si chiude se l'app va in background (messaggio al ritorno: «Connessione chiusa perché l'app era in background»).

**Messaggi di errore (mappatura risposta ELM327 → testo)**

| Risposta o situazione | Testo all'utente | Azione dell'app |
|---|---|---|
| `UNABLE TO CONNECT` | «L'adattatore risponde ma l'auto no. Gira la chiave su quadro acceso (senza avviare il motore) e riprova.» | Pausa e un solo nuovo tentativo ogni 2-3 s |
| `NO DATA` su tutte le richieste | «L'auto non risponde alle richieste. Verifica il quadro acceso; se continua, l'auto potrebbe non supportare l'OBD standard.» | Un tentativo; poi PID segnato «non supportato» |
| `BUS INIT: ...ERROR` | «Collegamento lento con l'auto: provo un altro protocollo.» | Passa a `ATSP0` / ripiego protocolli |
| `CAN ERROR`, `BUS ERROR`, `FB ERROR` | «Problema di comunicazione con l'auto. Controlla che l'adattatore sia inserito bene. Se si ripete l'adattatore potrebbe essere difettoso.» | Cambia protocollo e segnala |
| `LV RESET` | «L'adattatore si è riavviato per bassa tensione: ricollego.» | Init completo |
| Nessun `>` entro il timeout | «L'adattatore non risponde. Scollegalo e ricollegalo.» | Un `CR` per forzare il prompt, poi riconnessione |
| Disconnessione BLE | «Connessione persa. Riprovo…» | Backoff 1, 2, 4 s (massimo 3 tentativi), init completo |
| Adattatore non compatibile (iOS + Classic) | Vedi punto 2 | Non si prova a connettere |

**Modalità demo (adattatore simulato).** Dal pulsante «Prova senza adattatore» o da Impostazioni → Adattatori. Si sceglie lo **scenario** (S-59): *Benzina sana* (CAN 11 bit, nessun codice) · *Spia accesa* (due codici con freeze frame) · *Diesel* (EOBD, senza livello carburante) · *Clone economico* (risponde `?` alla sonda) · *K-line lenta* (init di 5-8 s) · *Auto spenta* (`UNABLE TO CONNECT`) · *Connessione instabile* (disconnessioni) · *Auto elettrica* (pochi PID). Regole: un banner fisso «MODALITÀ DEMO: dati simulati»; le sessioni demo sono marcate `simulator` e **non si salvano mai su un'auto reale** (solo sull'auto di esempio o non vengono salvate); il VIN di prova è fittizio (`ZFA19900001234567`, esempio sintetico del datasheet). La demo gira su PC (web), nei test e nella build; serve anche come dimostrazione per App Review insieme al video con hardware reale.

*Cosa non fa nell'MVP:* nessuna connessione in background (nessun foreground service, nessun `bluetooth-central`), nessun Classic/Wi-Fi, nessuna cancellazione dei codici.

#### 6.3.6 Interventi e tagliandi (compreso il cambio olio)

1. **S-20 Nuovo intervento.** *Tipo* (chip): Tagliando · Cambio olio e filtri · Freni · Gomme · Distribuzione · Batteria · Revisione · Carrozzeria · Altro. *Data* (oggi) e *km* (precompilato con l'ultimo noto; validazione di coerenza). *Officina* (ricerca o nuova). *Totale pagato* (lordo; input con virgola o punto). *Dettaglio righe* (facoltativo: manodopera, ricambi, fluidi con codice e specifica). *Fattura* o *foto* (allegati). *Garanzia fino al* (facoltativa). *Note*.
2. **Cambio olio**: campi aggiuntivi *specifica* (es. «5W-30 ACEA C3»), *litri*, *filtro sostituito*. Se l'olio è parte del tagliando, la voce «Cambio olio» si segna fatta dal «Cosa hai fatto?» senza doppioni.
3. **Salva → S-21 «Cosa hai fatto?»**: elenco delle voci attive pre-selezionate in base al tipo (tagliando → tagliando, olio, filtri). Per ogni voce confermata si crea un *completamento* e il motore ricalcola il prossimo dai valori **reali** (km e data dell'intervento). Esito mostrato: *«Prossimo cambio olio: tra 15.000 km o il 07/10/2027, il primo dei due.»*
4. **Revisione**: si chiede l'esito (*regolare*, *da ripetere*, *sospesa*). Regolare → nuova scadenza a fine mese (data revisione + 24 mesi); da ripetere → promemoria «nuova revisione entro un mese»; sospesa → avviso informativo («Dopo una revisione sospesa serve una nuova richiesta di revisione: leggi le indicazioni sul Portale dell'Automobilista»), senza dichiarazioni su dove si possa o non si possa circolare (W-13).
5. **Incoerenza dei km**: se i km non sono coerenti con le letture vicine, finestra con tre scelte: *Correggi*, *Salva senza aggiornare i km*, *È un errore della lettura precedente* (che viene ignorata).
6. **Modifica ed elimina**: soft delete; l'eliminazione annulla i completamenti collegati nella stessa transazione e riapre il promemoria.

#### 6.3.7 Assicurazione

1. **S-42 Nuova polizza.** *Tipo* (RC auto, Kasko, Furto e incendio, Altro) · *Compagnia*, *agenzia*, *n. polizza* · *Decorrenza* e **scadenza** (testo guida: *«Copia la scadenza dal certificato: è quella che conta.»*; se l'utente non la inserisce, si propone decorrenza + 12 mesi con etichetta «stimata») · *Premio annuo* e *frequenza* (annuale, semestrale, trimestrale, mensile) → rate generate (il resto in centesimi sulla prima) · *Classe di merito* (1-18) e *scatola nera* · *Contatti* (sinistri, assistenza, agente) · *Garanzie* (facoltative) · *PDF* del certificato o della polizza.
2. **Promemoria generato** «Scadenza RC auto — (nome della compagnia)» a 30, 14, 7, 1 e 0 giorni, più ripetizioni dopo la scadenza (+1, +3, +7, +14, +30) se ancora aperto [DAT §4.3]. Nota informativa: *«La legge prevede che la compagnia mantenga la garanzia fino a 15 giorni dopo la scadenza solo fino all'effetto della nuova polizza: non farci affidamento.»*
3. **Rinnovo**: pulsante «Rinnova» → nuova polizza precompilata (decorrenza proposta = scadenza precedente, modificabile); la vecchia risulta *rinnovata* e il suo promemoria si chiude. **Nessun rinnovo tacito** (abolito dal 2013): l'app non lo simula.
4. **Rate**: elenco con «Segna pagata»; promemoria a 7, 1 e 0 giorni prima di ogni rata non pagata.
5. **S-43 «In caso di incidente»**: targa, compagnia, n. polizza, numeri di assistenza e sinistri; pulsante «Condividi» (testo); funziona offline.

#### 6.3.8 Rifornimenti, spese e costi

**S-22 Rifornimento (obiettivo: meno di 10 secondi)**
1. Tastiera numerica sempre visibile; ordine dei campi: *Litri* · *€/litro* · *Totale*. Due campi qualsiasi calcolano il terzo; il calcolo non altera i campi già modificati dall'utente.
2. Precompilati: ultimo carburante, ultimo prezzo, **km** (suggerito da OBD se disponibile, altrimenti stima etichettata «stimato», sempre modificabile).
3. Interruttori: *Pieno* (predefinito) · *Parziale* · *Ho saltato un rifornimento*. Auto bifuel: selezione tra i carburanti dell'auto; i consumi si calcolano **per carburante**.
4. Validazioni *non bloccanti*: totale diverso da quantità × prezzo di più di 2 centesimi → «Il totale non torna: ricontrolla»; km inferiore all'ultima lettura → vedi 6.3.6 punto 5.
5. Dopo il salvataggio: banner con il consumo del pieno («6,1 L/100 km») e **Annulla**. Nessuna pubblicità, nessuna richiesta di recensione.
6. Elettrico: stessi passaggi con *kWh*; consumo in kWh/100 km.

**S-23 Spesa:** categoria (13 di sistema: assicurazione altro, bollo, revisione, parcheggio, pedaggi, multe, lavaggio, accessori, pratiche, finanziamento/noleggio, box, acquisto, altro; più personalizzate), importo, data, nota, allegato.

**S-60 Costi:** periodo (mese, anno, sempre) · totale e ripartizione per categoria · **costo al km** con spiegazione («costi del periodo diviso i km percorsi tra la prima e l'ultima lettura del periodo») · grafico a barre/linee **con alternativa tabellare** · i costi di interventi, rifornimenti, spese e rate pagate sono sommati **senza duplicati**.

#### 6.3.9 Controllo livelli

1. **S-24** elenca i fluidi con *ultima verifica*, *esito* e *prossimo controllo*: olio motore, refrigerante, liquido freni, lavavetri, AdBlue (se diesel), servosterzo, olio cambio, **pressione pneumatici**.
2. Tocco su un fluido → foglio a **3 tocchi**: *OK* · *Basso* · *Rabboccato* · *Alto*; solo con «Rabboccato»: quantità (ml o L) e prodotto; foto facoltativa. Suggerimenti brevi: olio → «motore freddo, auto in piano, con l'astina»; pressione → «a freddo, valori sul libretto o sull'adesivo del montante».
3. Il controllo crea (se l'utente inserisce i km) una lettura km collegata e completa l'eventuale promemoria di controllo; l'olio rabboccato si somma nell'anno (base per F-45, V1).
4. Riquadro **«Letto dall'auto»** con le ultime letture OBD (carburante %, temperatura refrigerante, tensione) e la data della sessione, etichettate «Letto dall'auto»; se non esiste alcuna sessione il riquadro invita a collegare l'auto.
5. Promemoria predefiniti (modificabili, attivi di default quelli per olio e pressione): *«Controlla il livello dell'olio ogni 1.000 km o prima di un viaggio lungo»*, *«Controlla la pressione a freddo ogni mese e prima dei viaggi»*; refrigerante e lavavetri mensili (spenti); AdBlue *«quando il cruscotto segnala meno di circa 2.000 km di autonomia»* (spento) [DAT §1.5, FEA §22].

#### 6.3.10 Documenti

1. **S-26** raggruppa per categoria: *Libretto / Documento Unico*, *Assicurazione*, *Fatture*, *Multe*, *Bollo (ricevute)*, *Altro*; ricerca per titolo.
2. **Aggiungi:** «Scatta una foto», «Scegli dalla galleria», «Scegli un PDF». I file vengono copiati nello storage privato dell'app, ridimensionati (foto) e con hash; non compaiono nella galleria del telefono.
3. Campi: titolo, categoria, data, **scadenza** (facoltativa: se inserita crea una scadenza personalizzata collegata), nota.
4. Con F-10 attivo l'apertura dei documenti richiede lo sblocco dell'app. Condivisione di un singolo file con il foglio di sistema.
5. *V1:* scansione OCR del libretto che precompila l'auto (F-75).

#### 6.3.11 Impostazioni, backup, ripristino, cancellazione

- **S-72 Backup e dati.** In alto «**Ultimo backup: oggi 14:32**» (o «Mai»). *Esporta backup* → avviso *«Il file contiene targhe, VIN e documenti in chiaro: conservalo con cura.»* → ZIP → foglio di condivisione (iCloud Drive, Google Drive, mail, PC); *Esporta CSV* (Excel italiano / dati); *Importa backup* → riepilogo («3 auto, 214 interventi, 36 allegati, creato il … con la versione …») → *Sostituisci* o *Unisci* → copia di sicurezza automatica → risultato («inseriti 214, aggiornati 3, mantenuti i locali 12»). Errori comprensibili: file non riconosciuto, backup creato con una versione più nuova («Aggiorna MyGarage»), conflitto di targa (proposta: «Sostituisci» o elimina l'auto locale).
- **S-71 Notifiche.** Interruttore generale, ora (predefinita 09:00), riservatezza (*generica*: mostra il soprannome, mai la targa; *completa*), **Verifica notifiche** (6.3.12).
- **S-73 Privacy e cancellazione.** Cosa si salva e dove (tutto sul dispositivo), informativa, **Cancella tutti i dati** (digitare «ELIMINA», nuova autenticazione se il blocco è attivo, procedura di 7 passi con verifica, avviso sui backup già condivisi).
- **S-74 Informazioni e stato del progetto.** Versione, data dell'ultimo aggiornamento, SDK, contatto e tempi di risposta, licenze di terzi.
- **S-75 Adattatori salvati** e unità di misura (km/miglia per auto).

#### 6.3.12 Notifiche: permesso e verifica

- Permesso chiesto *in contesto* (6.3.1 punto 4), mai al primo avvio. Stati: concesso (piano completo) · non ancora chiesto (banner «Attiva gli avvisi») · negato ma richiedibile (banner «Riprova», al massimo una richiesta ogni 30 giorni) · bloccato («Apri impostazioni»; l'app non insiste).
- **Verifica notifiche** (S-71): stato del permesso; su Android stato dei 4 canali (importanza *Nessuna* = silenziato); notifiche attese (dal piano) contro quelle presenti nel sistema; data e ora della prossima; esito dell'ultima sincronizzazione; pulsanti «Invia una notifica di prova tra 10 secondi» e «Ripianifica adesso»; guida all'ottimizzazione della batteria su Android con link a dontkillmyapp.com.
- Contenuto: titolo = nome della voce («Revisione»), corpo = «Panda: scade il 30/11/2026 (tra 14 giorni)». Nessun numero di km nel testo; le scadenze a km sono «stimate».
- Un tocco sulla notifica apre la scheda della scadenza (`mygarage://reminder/<id>`).

#### 6.3.13 Casi limite trasversali

| Caso | Comportamento |
|---|---|
| Prima apertura senza rete | Tutto funziona: nessuna chiamata di rete (D-02) |
| Fine mese e anni bisestili | Si ragiona su (anno, mese): 29/02 negli anni bisestili; 31/01 + 1 mese = 28/02 (o 29/02) |
| Cambio ora legale / fuso | Notifiche alle 09:00 locali (fuori dalla finestra 02:00-03:00); al ritorno in primo piano si confronta il fuso e si ripianifica se differisce |
| Database più nuovo dell'app (dopo un import) | Schermata «Aggiorna MyGarage», nessuna scrittura |
| Migrazione che fallisce | Rollback, copia `VACUUM INTO` pre-migrazione, schermata di recupero con «Esporta DB grezzo» e «Ripristina da backup»: mai un crash silenzioso |
| Contachilometri sostituito o azzerato | La lettura errata si ignora (`status = ignored`) e si prosegue; un «epoch» per veicolo è una domanda aperta [DAT domande aperte n. 8] |
| Auto venduta | Stato «venduta» con data, km e prezzo; i promemoria si fermano; l'archivio resta consultabile ed esportabile (F-50 in V1) |

## 7. Regole italiane delle scadenze

**Avvertenza generale (mostrata in app):** *«Le scadenze sono calcolate in base ai dati che hai inserito e hanno valore informativo. Non sostituiscono le comunicazioni ufficiali né i controlli sul Portale dell'Automobilista, ACI, Agenzia delle Entrate, IVASS o la tua Regione. Se hai la data scritta su un documento ufficiale, inseriscila: vale sempre più del calcolo.»*

Principi di implementazione [REG §0, §12]:
1. ogni scadenza si può **sovrascrivere** con la data letta sul documento ufficiale (`manualDueBy`);
2. ogni regola è un **dato** con `validFrom`, `validTo`, `source`, `confidence` e `lastVerified`, mostrati nella scheda della scadenza;
3. ogni funzione restituisce anche `basis` (da cosa è stata calcolata) e `confidence` (`official`, `practice`, `indicative`);
4. gli importi di sanzioni e tariffe stanno in un **file di configurazione versionato** e si presentano sempre come «indicativi», mai «dovuti»;
5. rilettura manuale delle fonti **ogni 6 mesi e prima di ogni rilascio**; controlli puntuali: dopo il **2026-11-16** (conversione del D.L. 162/2026) e dopo il **2026-12-01** (adeguamento biennale ISTAT degli importi, art. 195 c.3 CdS);
6. date come `YYYY-MM-DD` (fuso Europe/Rome), mai `Date` locale per sommare mesi o giorni; «entro il mese» = ultimo giorno del mese, inclusivo; una scadenza è «superata» dal giorno dopo.

### 7.1 Catalogo precaricato (27 voci)

Seed canonico di [DAT §1.5]. Le voci con «indicativo = sì» sono consigli tecnici (D-08): **il libretto di uso e manutenzione del costruttore prevale** e ogni intervallo è modificabile. Preavvisi in giorni prima della scadenza (0 = il giorno stesso). Vale «il primo dei due» tra km e mesi.

| Id | Voce | Categoria | Tipo | Km | Mesi | Fine mese | Annuale | Preavvisi | Si applica a | Attiva di default | Indicativo |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `tpl_inspection` | Revisione periodica | legale | dall'ultimo fatto | — | 24 | sì | — | 60, 30, 14, 7, 0 | tutte | sì | no |
| `tpl_road_tax` | Bollo auto | legale | serie di calendario | — | 12 | — | — | 30, 15, 7, 0 | tutte | sì | no |
| `tpl_gas_cylinder` | Riqualifica bombola GPL/metano | legale | data fissa | — | — | — | — | 90, 30, 7, 0 | gas | sì | no |
| `tpl_gas_system_check` | Controllo impianto GPL/metano | manutenzione | dall'ultimo fatto | — | 12 | — | — | 14, 3, 0 | gas | sì | sì |
| `tpl_service_main` | Tagliando | manutenzione | dall'ultimo fatto | 15.000 | 12 | — | — | 14, 3, 0 | tutte | sì | sì |
| `tpl_oil_change` | Cambio olio motore e filtro | manutenzione | dall'ultimo fatto | 15.000 | 12 | — | — | 14, 3, 0 | termiche | sì | sì |
| `tpl_cabin_filter` | Filtro abitacolo | manutenzione | dall'ultimo fatto | 15.000 | 12 | — | — | 14, 0 | tutte | sì | sì |
| `tpl_air_filter` | Filtro aria motore | manutenzione | dall'ultimo fatto | 30.000 | 24 | — | — | 14, 0 | termiche | sì | sì |
| `tpl_fuel_filter` | Filtro carburante | manutenzione | dall'ultimo fatto | 30.000 | 24 | — | — | 14, 0 | diesel | sì | sì |
| `tpl_spark_plugs` | Candele | manutenzione | dall'ultimo fatto | 60.000 | 48 | — | — | 30, 7, 0 | benzina | sì | sì |
| `tpl_timing_belt` | Cinghia di distribuzione | manutenzione | dall'ultimo fatto | 120.000 | 60 | — | — | 90, 30, 7, 0 | termiche | **no** | sì |
| `tpl_brake_fluid` | Liquido freni | manutenzione | dall'ultimo fatto | — | 24 | — | — | 30, 7, 0 | tutte | sì | sì |
| `tpl_coolant` | Liquido refrigerante | manutenzione | dall'ultimo fatto | 60.000 | 48 | — | — | 30, 7, 0 | termiche | sì | sì |
| `tpl_brake_inspection` | Controllo freni (pastiglie e dischi) | manutenzione | dall'ultimo fatto | 20.000 | 12 | — | — | 14, 0 | tutte | sì | sì |
| `tpl_battery_check` | Controllo batteria 12 V | manutenzione | dall'ultimo fatto | — | 12 | — | — | 14, 0 | tutte | sì | sì |
| `tpl_battery_replace` | Sostituzione batteria 12 V | manutenzione | dall'ultimo fatto | — | 60 | — | — | 60, 14, 0 | tutte | **no** | sì |
| `tpl_wipers` | Spazzole tergicristallo | manutenzione | dall'ultimo fatto | — | 12 | — | — | 7, 0 | tutte | sì | sì |
| `tpl_ac_service` | Climatizzatore: sanificazione/ricarica | manutenzione | dall'ultimo fatto | — | 24 | — | — | 14, 0 | tutte | **no** | sì |
| `tpl_gearbox_oil` | Olio cambio | manutenzione | dall'ultimo fatto | 90.000 | 72 | — | — | 30, 7, 0 | tutte | **no** | sì |
| `tpl_ev_service` | Controllo veicolo elettrico | manutenzione | dall'ultimo fatto | 30.000 | 24 | — | — | 14, 3, 0 | elettriche | sì | sì |
| `tpl_tyre_rotation` | Rotazione pneumatici | gomme | dall'ultimo fatto | 10.000 | — | — | — | 7, 0 | tutte | **no** | sì |
| `tpl_check_oil_level` | Controlla livello olio motore | controllo | dall'ultimo fatto | 1.000 | 1 | — | — | 0 | termiche | sì | sì |
| `tpl_check_tyre_pressure` | Controlla pressione pneumatici (a freddo) | controllo | dall'ultimo fatto | — | 1 | — | — | 0 | tutte | sì | sì |
| `tpl_check_coolant_washer` | Controlla refrigerante e lavavetri | controllo | dall'ultimo fatto | — | 1 | — | — | 0 | termiche | **no** | sì |
| `tpl_check_adblue` | Controlla AdBlue | controllo | dall'ultimo fatto | 2.000 | — | — | — | 0 | diesel | **no** | sì |
| `tpl_tyres_winter` | Montaggio gomme invernali | gomme | serie di calendario | — | 12 | — | 15/11 | 14, 3, 0 | tutte | **no** | no |
| `tpl_tyres_summer` | Montaggio gomme estive | gomme | serie di calendario | — | 12 | — | 15/4 | 14, 3, 0 | tutte | **no** | no |

*Filtri di applicabilità:* «termiche» = auto non elettriche pure; «gas» = GPL o metano, primario o secondario; i tag sono derivati e mai salvati. Le **ripetizioni dopo la scadenza** (se il promemoria è ancora aperto): legali e assicurazione +1, +3, +7, +14, +30 giorni; manutenzione e gomme +1, +3, +7; controlli nessuna; poi silenzio e banner in «Oggi» [DAT §4.3]. **Parametri da validare:** gli intervalli vanno confrontati con i libretti di 3-5 auto italiane diffuse prima del rilascio (SP-9). Range di mercato di riferimento (confidenza media-bassa, **non verificati su manuali di costruttori**) [REG §9.2]: tagliando 15.000-30.000 km / 12-24 mesi; olio motore 10.000-20.000 km / 12 mesi; cinghia di distribuzione 60.000-120.000 km / 5-10 anni; liquido freni 24 mesi; refrigerante 60.000-150.000 km / 3-5 anni; batteria 4-6 anni.

### 7.2 Revisione periodica (art. 80 CdS) — F-21

| Punto | Regola | Confidenza |
|---|---|---|
| Prima revisione | 4 anni dalla prima immatricolazione, entro la **fine del mese**. *Nota:* il testo di legge dice solo «entro quattro anni dalla data di prima immatricolazione e successivamente ogni due anni»; «entro il mese» è prassi MIT («mese di rilascio della carta di circolazione») | alta (4 anni); media (fine mese) |
| Successive | Ogni 2 anni, entro il mese corrispondente a quello dell'**ultima revisione effettivamente eseguita** (anche se anticipata) | media (testo MIT) |
| Annuale (fuori target) | Taxi, NCC, ambulanze, autobus e veicoli con più di 9 posti, merci oltre 3.500 kg | alta |
| Dove | Motorizzazione (45,00 EUR) o centro privato autorizzato (circa 79 EUR IVA inclusa) | media |
| Controllo OBD | Dal 2024 i centri hanno lo scantool; per M1/M2/N1 Euro 5/6 immatricolati dal 1-9-2009 la spia MIL accesa dà esito irregolare (vedi 5.5) | media |
| Casi aperti | Revisione molto anticipata o tardiva; auto importate (4 anni dalla prima immatricolazione estera o italiana?); veicoli storici | **bassa**: si mostra un avviso e si lascia l'override |
| Pacchetto UE | Proposta di revisione annuale oltre i 10 anni respinta da Consiglio e commissione TRAN; non definitiva | media: **l'intervallo di 24 mesi è un dato configurabile, non una costante** |

**Calcolo:** prima scadenza = fine del mese di (immatricolazione + 48 mesi); poi = fine del mese di (ultima revisione + 24 mesi); `manualDueBy` vince su tutto. Preavvisi: 60, 30, 14, 7 giorni prima e il giorno stesso, come nel catalogo (la serie alternativa proposta in [REG §1.5] non è adottata: RC-10).

| # | Input | Atteso |
|---|---|---|
| R1 | Immatricolazione 2022-03-15, nessuna revisione | 2026-03-31 (base: prima immatricolazione) |
| R2 | Immatricolazione 2022-03-15, ultima revisione 2026-03-10 | 2028-03-31 |
| R3 | Immatricolazione 2020-02-29 | 2024-02-29 (anno bisestile) |
| R4 | Immatricolazione 2022-06-10, ultima revisione 2026-02-12 (anticipata) | 2028-02-29 |
| R5 | Ultima revisione 2025-12-31 | 2027-12-31 |
| R6 | Ultima revisione 2026-01-31 | 2028-01-31 (conta il mese, non il giorno) |
| R7 | Oggi 2026-03-31, scadenza 2026-03-31 | «Scade oggi», 0 giorni |
| R8 | Oggi 2026-04-01, scadenza 2026-03-31 | «Scaduta da 1 giorno» |
| R9 | `manualDueBy` 2027-05-31 con qualunque altro dato | 2027-05-31, base manuale |

**Esiti** (campo manuale): *regolare* (nuova scadenza), *da ripetere* (nuova revisione entro un mese di calendario), *sospesa* (serve una nuova richiesta di revisione). *Revisione singola dopo incidente* (art. 80 c.7): solo promemoria manuale con la data indicata dalla Motorizzazione.

**Testo di avvertenza:** *«La scadenza è calcolata dalla prima immatricolazione o dall'ultima revisione che hai inserito (art. 80 del Codice della Strada: prima revisione dopo 4 anni, poi ogni 2, entro l'ultimo giorno del mese). È un promemoria: controlla la data effettiva sul Portale dell'Automobilista (servizio "Verifica revisioni effettuate"). Circolare con la revisione scaduta comporta una sanzione da circa 173 a 694 euro. Se dopo un incidente la Motorizzazione dispone una revisione singola, segui la data indicata nella sua comunicazione.»* Prima di prenotare: *«Leggi i codici con MyGarage: con la spia motore accesa la revisione dà esito irregolare.»*

**Fonti (URL):** https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:1992-04-30;285 · https://www.mit.gov.it/node/2789 · https://www.ilportaledellautomobilista.it/web/portale-automobilista/veicoli/revisioni · https://aci.gov.it/codice-della-strada/art-80/ · https://www.lautomobile.aci.it/come-fare-per/revisione-auto-2024-2025-costi-scadenze-e-novita/ · https://www.alvolante.it/news/no-del-consiglio-ue-alla-revisione-annuale-delle-auto-409751. Confidenza: alta sui 4 anni, sulle sanzioni (173-694 EUR) e sui vettori; media sulla regola «fine mese» e sulle revisioni anticipate.

### 7.3 Bollo auto — F-22

**L'app calcola la scadenza, non l'importo.** Rimanda al calcolo ufficiale ACI e ai canali di pagamento (pagoPA, app IO, ACI, tabaccherie, Poste, banche).

| Punto | Regola | Confidenza |
|---|---|---|
| Primo pagamento (regime fino al 31-12-2027) | Entro la fine del mese di immatricolazione; se l'immatricolazione cade negli ultimi 10 giorni del mese, entro il mese successivo. Lombardia, Piemonte, Trento e Bolzano: sempre il mese successivo | alta (struttura); media (eccezioni regionali) |
| Rinnovo | Ogni anno entro la fine del **mese di pagamento** (coincide con il mese di immatricolazione per un periodo di 12 mesi). **Distinzione decisiva:** la «scadenza» del bollo è la fine del periodo coperto; il «termine di versamento» è la fine del mese *successivo*. Inserire il mese sbagliato sposta la scadenza di un mese | alta |
| Dal 1-1-2028 (D.Lgs. 147/2026, in vigore dal 12-8-2026) | Primo pagamento entro la fine del mese successivo all'immatricolazione; rinnovi entro la fine del mese di immatricolazione; i veicoli immatricolati fino al 31-12-2027 mantengono le regole precedenti | media; [DA VERIFICARE] il testo in Gazzetta e l'eventuale rateizzazione dal 2028 |
| Esenzione 2027 (D.L. 162/2026, GU n. 216 del 17-9-2026) | Auto a benzina o gasolio (anche ibride) fino a 80 kW, persone fisiche, **un solo veicolo**, **regolarmente assicurato**, solo per i versamenti con scadenza ordinaria dal 1-1 al 31-12-2027; nelle Regioni a statuto speciale solo previo accordo; **decreto-legge da convertire entro il 2026-11-16: possibili modifiche** | media |
| Slittamento di sabato/festivi | Fonti secondarie: si può pagare il primo giorno lavorativo successivo | media: **l'app non applica lo slittamento** (calcolo prudenziale) |
| Ravvedimento operoso, prescrizione | Esistono; l'app **non calcola** sanzioni e interessi | — |

*Campo di inserimento:* **«Mese di pagamento»** (ultimo mese utile per versare), con testo guida: *«Non è il mese di "scadenza" mostrato da ACI (che è il mese prima). Se non sei sicuro, è di norma il mese di immatricolazione.»* Default = mese della prima immatricolazione (o del primo pagamento).

*Etichetta informativa 2027:* quando l'auto ha benzina/gasolio con `power_kw ≤ 80` e la scadenza 2027 cade nel regime: **«Possibile esenzione 2027 (D.L. 162/2026): verifica i requisiti»**; il promemoria **non** viene cancellato.

| # | Input | Atteso |
|---|---|---|
| B1 | Rinnovo anno 2026, immatricolazione 2022-03-15 | 2026-03-31 |
| B2 | Primo pagamento, immatricolazione 2026-03-05, altra Regione | 2026-03-31 |
| B3 | Primo pagamento, immatricolazione 2026-03-25 (ultimi 10 giorni) | 2026-04-30 |
| B4 | Primo pagamento, immatricolazione 2026-03-05, Lombardia | 2026-04-30 |
| B5 | Primo pagamento, immatricolazione 2028-02-10 (regime 2028) | 2028-03-31 |
| B6 | Primo pagamento, immatricolazione 2026-02-20 (febbraio ha 28 giorni) | 2026-03-31 |
| B7 | Primo pagamento, immatricolazione 2026-03-21 | 2026-03-31 |
| B13 | Rinnovo 2027 con «mese di pagamento» = 5 | 2027-05-31 (con un «mese di scadenza ACI» = 5 sarebbe 2027-06-30: per questo il campo si chiama «mese di pagamento») |
| B14 | Primo pagamento, immatricolazione 2026-03-05, Trento o Bolzano | 2026-04-30 |

**Testo di avvertenza:** *«Il bollo è una tassa regionale: la scadenza è calcolata dal mese di pagamento che hai inserito (o dal mese di immatricolazione) e può differire nella tua Regione. Per importo, periodo e stato dei pagamenti consulta il calcolo ufficiale ACI o il sito della tua Regione. Per il 2027 è prevista (D.L. 162/2026, in conversione) un'esenzione per auto a benzina o gasolio fino a 80 kW intestate a persone fisiche, per un solo veicolo e solo se assicurato: verifica i requisiti prima di non pagare.»*

**Fonti (URL):** https://www.lautomobile.aci.it/attualita/bollo-auto-2026-scadenze-tariffe-ed-esenzioni-la-guida-completa/ · https://www.lautomobile.aci.it/attualita/bollo-auto-tutte-le-novita-dal-2026-al-2028/ · https://www.lautomobile.aci.it/attualita/addio-al-bollo-auto/ · https://www.informazionefiscale.it/bollo-auto-novita-scadenze-obblighi-controlli · https://online.aci.it/acinet/calcolobollo/index.asp. Confidenza: alta sulla struttura e sulla distinzione scadenza/versamento; media sulle eccezioni regionali e sui decreti del 2026.

### 7.4 Assicurazione RC auto — F-52, F-53

| Punto | Regola | Confidenza |
|---|---|---|
| Durata e rinnovo | Contratto annuale (o «anno più frazione»); **nessun tacito rinnovo** (si risolve alla scadenza naturale; abolizione dal 1-1-2013) | alta (testo art. 170-bis letto); media (data) |
| Preavviso | L'impresa deve avvisare della scadenza con almeno 30 giorni di anticipo (obbligo di legge) | alta |
| Tolleranza | La compagnia mantiene operante la garanzia precedente **non oltre il quindicesimo giorno** dalla scadenza *fino all'effetto della nuova polizza* (art. 170-bis c.1): è un ponte per cambiare compagnia, non una proroga; non vale all'estero | alta |
| Attestato di rischio | Dematerializzato dal 1-7-2015, nell'area clienti; classe di merito 1-18 | media |
| Sanzione per mancata copertura | 866-3.464 EUR, sequestro, sospensione patente in caso di recidiva; la mancanza può emergere anche incrociando polizze e rilevatori (L. 177/2024) | alta |
| Garanzie accessorie | Nessun tacito rinnovo se contestuali al rischio principale (art. 170-bis c.1-bis) | media |

*Regole di prodotto:* la scadenza è **quella stampata sul certificato** (il calcolo decorrenza + 12 mesi è solo un default etichettato «stimata»); il giorno di scadenza è «ultimo giorno coperto»; la tolleranza **non** sposta mai la data né i promemoria; compare solo come nota informativa.

| # | Input | Atteso |
|---|---|---|
| A1 | Decorrenza 2025-03-10 | scadenza 2026-03-10; fine tolleranza 2026-03-25 |
| A2 | Decorrenza 2024-02-29 | scadenza 2025-02-28; fine tolleranza 2025-03-15 |
| A3 | Oggi 2026-03-10, scadenza 2026-03-10 | «Scade oggi» |
| A4 | Oggi 2026-03-20, scadenza 2026-03-10 | «In tolleranza» (nota informativa), 10 giorni di ritardo |
| A5 | Oggi 2026-03-25 | «In tolleranza» (ultimo giorno), 15 giorni |
| A6 | Oggi 2026-03-26 | «Scoperta», 16 giorni |
| A8 | Promemoria per scadenza 2026-03-10 (serie 45, 30, 15, 7, 1, 0) | 24/1, 8/2, 23/2, 3/3, 9/3, 10/3 *(l'app usa i preavvisi 30, 14, 7, 1, 0 del catalogo; il vettore verifica l'aritmetica delle date)* |

**Testo di avvertenza:** *«La data di scadenza è quella indicata sul tuo contratto o certificato: controllala. La polizza non si rinnova automaticamente: se non ne stipuli una nuova resti senza copertura. La legge prevede che la compagnia mantenga la garanzia fino a 15 giorni dopo la scadenza solo fino all'effetto della nuova polizza: non farci affidamento. Circolare senza assicurazione comporta una sanzione da 866 a 3.464 euro e il sequestro del veicolo.»*

**Fonti (URL):** https://www.ivass.it/consumatori/quesiti/r.c.auto/index.html · https://aci.gov.it/codice-della-strada/art-193/ · https://www.ilportaledellautomobilista.it/web/portale-automobilista/-/rc-auto-mai-piu-rinnovo-tacito · https://www.sicurauto.it/news/codice-della-strada/rc-auto-dal-1-agosto-il-periodo-di-tolleranza-torna-di-15-giorni/. Confidenza: alta (testo dell'art. 170-bis letto dalla verifica); media sulla data di abolizione del tacito rinnovo.

### 7.5 Pneumatici invernali, battistrada, DOT — F-29, F-46

| Punto | Regola | Confidenza |
|---|---|---|
| Obbligo | **Non esiste un obbligo nazionale indistinto**: dove c'è segnaletica o ordinanza, dal 15 novembre al 15 aprile servono pneumatici invernali (M+S o 3PMSF) **oppure catene a bordo** | alta |
| Montaggio anticipato | Consentito dal 15 ottobre | alta |
| Invernali con indice di velocità inferiore al libretto | Ammessi dal 15 ottobre al 15 maggio se l'indice non è inferiore a Q (circolare MIT 1049/2014) | alta |
| Sanzioni | 87-344 EUR fuori dai centri abitati (art. 6); 42-173 EUR dentro (art. 7) | alta |
| Catene e «calze» | Catene omologate e della misura giusta; con estive anche dispositivi conformi a UNI EN 16662-1:2020 | media-alta |
| Battistrada minimo | 1,6 mm | media [DA VERIFICARE su fonte primaria] |
| Battistrada consigliato | 3 mm (4 mm in inverno: soglia non verificata) | media (consiglio, non obbligo) |
| Età (DOT) | Nessun limite di legge trovato; consiglio: controllo dopo 5 anni, sostituzione intorno ai 10 | media-bassa |

Funzioni: calendario `winterTyreCalendar(anno)` (15/10, 15/11, 15/4, 15/5); stato battistrada (`illegale` sotto 1,6 mm, `da_sostituire_presto` sotto 3, `sconsigliato_inverno` sotto 4 in inverno, `ok`); DOT `WWYY` → data di produzione approssimata (lunedì della settimana) → età. Vettori: T1 `winterTyreCalendar(2026)` → 2026-10-15, 2026-11-15, 2027-04-15, 2027-05-15; T2 1,5 mm → illegale; T3 1,6 mm → da_sostituire_presto; T4 3,5 mm inverno → sconsigliato_inverno; T5 4,0 mm inverno → ok; T6 DOT `1219`, oggi 2026-10-07 → produzione 2019-03-19, età ≈ 7,55 anni; T7 DOT `4524` → 2024-11-04, ≈ 1,92 anni. Il DOT a 3 cifre (prima del 2000) non si gestisce.

**Testo di avvertenza:** *«Dal 15 novembre al 15 aprile, dove c'è l'apposita segnaletica o ordinanza, devi avere pneumatici invernali montati oppure le catene a bordo. Non c'è un obbligo valido ovunque: controlla le ordinanze del percorso. Il battistrada minimo di legge è 1,6 mm, ma sotto i 3-4 mm la sicurezza cala molto. L'età (codice DOT) è un'indicazione prudenziale.»*

**Fonti (URL):** https://www.lautomobile.aci.it/attualita/gomme-invernali-2026-dal-15-ottobre-si-possono-montare-obbligo-date-e-multe/ · https://www.poliziadistato.it/articolo/dal-15-novembre-scatta-l-obbligo-degli-pneumatici-invernali. Confidenza: alta su periodi, indice Q e sanzioni; media-bassa su battistrada consigliato ed età.

### 7.6 Bombole GPL e metano — F-30 (confidenza bassa)

| Impianto | Regola | Confidenza |
|---|---|---|
| Metano, omologazione nazionale (DGM) | Riqualificazione ogni 5 anni | media |
| Metano, R110 | Ogni 4 anni (DM 13-5-2022 n. 144, in vigore dal 14-7-2022), dalla data di immatricolazione indicata sul libretto | media |
| Metano, R110 tipo IV (composito) | Prima riqualificazione a 4 anni; l'intervallo successivo **non è chiaro** (2 o 4 anni) | **bassa** [DA VERIFICARE] |
| Vita massima bombola metano | 20 anni dall'installazione | media |
| Serbatoio GPL | 10 anni; **la data di riferimento (costruzione, immatricolazione o installazione) è in conflitto tra le fonti** | **bassa** [DA VERIFICARE] |

*Decisione:* **nessun calcolo automatico**. Il tipo di omologazione e la data si leggono su targhetta e libretto: la voce è «data fissa» inserita dall'utente (foto del cartellino consigliata). Quando il tipo è noto, l'app può proporre una data *indicativa* etichettata «da verificare con l'officina». **Testo:** *«Le bombole del metano e il serbatoio del GPL hanno scadenze di sicurezza che dipendono dal tipo di omologazione e dalla data riportata su targhetta e libretto. Le date calcolate sono indicative: verificale con la tua officina autorizzata.»*

**Fonti (URL):** https://www.federmetano.it/revisione-bombole-metano/ · https://www.sicurauto.it/news/codice-della-strada/revisione-bombole-metano-cosa-prevede-il-nuovo-decreto-13-5-2022/. Confidenza: **media-bassa** (fonti di settore, nessun testo del DM letto).

### 7.7 Patente di guida (V1) — F-31

Durata A/B: 10 anni fino a 50 anni di età, 5 anni da 50 a 70, 3 anni da 70 a 80, 2 anni oltre. **Regola del compleanno** (solo A/B con scadenza ordinaria, dal 17-9-2012; escluse C, D, CQC e i rinnovi con visita medica locale o specialistica): la scadenza effettiva è il **primo compleanno successivo alla scadenza ordinaria** (data rinnovo + N anni), **non** il compleanno dell'anno di rinnovo + N (errore corretto dalla verifica). Neopatentati: limiti di potenza per 3 anni (75 kW/t; 105 kW per le M1) **solo per patenti conseguite dal 14-12-2024**; prima vale 1 anno. Sanzione per patente scaduta 158-638 EUR + ritiro (art. 126 c.11). La direttiva UE 2025/2205 (patente 15 anni) **non è in vigore in Italia** fino al recepimento (circa 2028-2029). Il campo 4b della patente vince sempre. Vettori: P1 nato 1985-04-12, rinnovo 2026-03-01 → 2036-04-12; P2 nato 1970-09-30, rinnovo 2026-05-10 → 2031-09-30; P3 nato 1950-01-20, rinnovo 2026-01-10 → 2029-01-20; **P5** nato 1988-02-29, rinnovo 2027-05-01 → **2038-02-28**; **P9** nato 1985-04-12, rinnovo 2026-06-01 → **2037-04-12**; **P10** nato 1960-03-10, rinnovo 2026-09-20 → **2032-03-10**; P7 patente conseguita 2024-12-20 → limiti fino al 2027-12-20. Punti aperti: soglie esatte a 50 e 70 anni nel giorno del compleanno (P6), rinnovo degli ultraottantenni (P4), clamp del 29 febbraio. Poiché la patente non è legata a un veicolo, serve un profilo conducente (sezione 8.2).

**Fonti (URL):** https://aci.gov.it/codice-della-strada/art-126/ · https://www.ilportaledellautomobilista.it/web/portale-automobilista/-/mit-la-patente-scade-al-compleanno · https://www.mit.gov.it/rinnovo-patente. Confidenza: alta sulla regola del compleanno e sulla struttura; media sulle soglie esatte.

### 7.8 Passaggio di proprietà (V1) — F-32

La richiesta di trascrizione al PRA e di aggiornamento del Documento Unico va fatta dall'acquirente **entro 60 giorni dalla data di autentica** della firma del venditore (art. 94 c.1 CdS: alta confidenza). Preavvisi a 30, 45, 55 e 60 giorni dopo l'autentica. Oltre il termine: sanzioni sull'IPT e, per l'art. 94, sanzioni amministrative di 727-3.629 EUR (c.3) e 363-1.813 EUR (c.4). Vettori: autentica 2026-09-01 → 2026-10-31; 2026-01-15 → 2026-03-16; 2026-12-20 → 2027-02-18. Dal 12-8-2026 (D.Lgs. 147/2026) per le cessioni a un rivenditore il venditore resta obbligato al bollo fino alla trascrizione.

**Fonti (URL):** https://aci.gov.it/pratica-auto/passaggio-di-proprieta-mancata-trascrizione-al-pra/ · https://aci.gov.it/codice-della-strada/art-94/. Confidenza: alta sui 60 giorni; media sugli importi.

### 7.9 Garanzia e officine indipendenti

Informazione per l'utente (confidenza alta, FAQ della Commissione UE; Reg. UE 461/2010 prorogato fino al 31-5-2028): il tagliando può essere fatto in un'officina indipendente senza perdere la garanzia del costruttore, purché gli interventi siano eseguiti a regola d'arte e con ricambi di qualità equivalente; il costruttore può rifiutare la garanzia solo per guasti causati da lavori eseguiti male. **Conserva le fatture** (promemoria nell'app dopo ogni intervento). Le condizioni di una garanzia estesa a pagamento vanno comunque lette.

**Fonte (URL):** https://competition-policy.ec.europa.eu/system/files/2021-09/FAQ_application_of_EU_antitrust_rules_in_the_motor_vehicle_sector_en.pdf. Confidenza: alta.

### 7.10 Limitazioni ambientali, bollino blu, ZTL (V2)

Regole locali e variabili; **nessun calcolo**. Solo scadenze manuali (bollino blu, permesso ZTL) e, in V2, un promemoria informativo stagionale («Verifica le limitazioni antismog per la classe Euro della tua auto nel tuo comune»). Mai «puoi/non puoi circolare»: si usa «potrebbero applicarsi limitazioni». Le fonti sul blocco dei diesel Euro 5 sono discordanti.

## 8. Dati e architettura

Fonte principale: [DAT] (DDL eseguito e testato: 28 tabelle, 74 indici, 23 trigger, 3 viste, tutto `STRICT`; 240 controlli passati su Node 24.19 / SQLite 3.53.3). Cosa **non** è provato: versione di SQLite dentro `expo-sqlite` 57, `Date`/`Intl` su Hermes, notifiche reali, biometria, BLE (SP-1, SP-2, SP-3, SP-4).

**Fonti (URL):** https://docs.expo.dev/versions/latest/sdk/sqlite/ · https://docs.expo.dev/versions/latest/sdk/notifications/ · https://docs.expo.dev/versions/latest/sdk/securestore/ · https://docs.expo.dev/versions/latest/sdk/background-task/ · https://developer.android.com/develop/background-work/services/alarms/schedule · https://developer.apple.com/forums/thread/811171. Confidenza: **alta** sulle scelte di progetto e sul codice eseguito su PC; **media** sul comportamento su telefono (da provare).

### 8.1 Convenzioni del dato

| Tema | Regola |
|---|---|
| Chiavi | ULID di 26 caratteri generato nell'app (ordinabile per tempo, nessuna collisione tra dispositivi); i cataloghi usano slug (`tpl_…`, `sys_…`) |
| Date di calendario | `TEXT 'YYYY-MM-DD'` con `CHECK (date(x) IS x)`; suffisso `_on`; nessun fuso |
| Istanti | `TEXT` ISO UTC con millisecondi; suffisso `_at`; solo per audit, sessioni OBD, snooze, notifiche |
| Denaro | `INTEGER` centesimi (`*_cents`); prezzo al litro in **millesimi** di euro (`unit_price_milli`: 1,859 EUR/L = 1859); nessuna colonna valuta nell'MVP |
| Distanze | `INTEGER` km (0..2.000.000); la preferenza km/miglia è solo di visualizzazione (`vehicles.distance_unit`); conversione una sola volta, quando l'utente scrive (`miToKm`, round-trip esatto sugli interi) |
| Quantità | `INTEGER` in millesimi dell'unità (ml, Wh, g); litri per benzina/gasolio/GPL/AdBlue/HVO, kg per metano e idrogeno, kWh per l'elettrico |
| Audit e cestino | `created_at`, `updated_at` (trigger che non sovrascrive se il codice li ha già toccati: l'import preserva i timestamp), `deleted_at`; cestino di 30 giorni |
| Integrità | `PRAGMA foreign_keys = ON` ad ogni connessione; `ON DELETE CASCADE` dai figli al veicolo; `SET NULL` per riferimenti «morbidi»; `STRICT` ovunque |
| PRAGMA all'apertura di ogni connessione (app e task in background) | `foreign_keys = ON`, `journal_mode = WAL`, `synchronous = NORMAL`, `busy_timeout = 5000`, `secure_delete = ON` |
| Targa e VIN | Solo in `vehicles` (dati personali); le sessioni OBD salvano solo `vin_matches` (0/1); mai nei log, nelle notifiche di default o negli URL |

### 8.2 Schema e modifiche richieste da questa specifica

**Mappa delle tabelle** [DAT §1.2]:

| Area | Tabelle |
|---|---|
| Infrastruttura | `migrations_log`, `app_settings` |
| Cataloghi | `service_templates` (27 voci), `expense_categories` (13 di sistema) |
| Veicoli e adattatori | `vehicles`, `obd_adapters` |
| Chilometri | `odometer_readings` (**unica fonte dei km**, coerenza monotona garantita da trigger tra giorni diversi; `status = ignored` per le letture errate) |
| Interventi | `workshops`, `service_records`, `service_lines` |
| Regole e promemoria | `maintenance_items` (regola), `maintenance_completions` (storico append-only), `reminders` (occorrenza, uno solo aperto per regola), `notification_schedule` |
| Assicurazione | `insurance_policies`, `insurance_coverages`, `insurance_payments` |
| Carburante e spese | `fuel_logs`, `expenses`, vista `v_costs` (nessun doppione tra interventi, rifornimenti, spese e rate pagate) |
| Livelli | `fluid_checks` |
| Pneumatici | `tyre_sets`, `tyre_fitments` |
| File | `attachments` (un solo genitore), `pending_file_deletions` (coda di cancellazione che sopravvive a un crash) |
| OBD | `obd_sessions`, `telemetry_samples` (25 byte/riga misurati), `telemetry_rollups`, `dtc_events` |

**Modifiche a `0001_init` da fare prima del primo rilascio** (finché non esistono installazioni la migrazione si può riscrivere [DAT §8.9]):

| ID | Modifica | Motivo |
|---|---|---|
| M-1 | `fluid_checks.fluid`: aggiungere `tyre_pressure`; colonna facoltativa `value_millibar INTEGER CHECK (value_millibar BETWEEN 500 AND 6000)` | F-44 include la pressione dei pneumatici, oggi assente dal `CHECK` |
| M-2 | `fuel_logs.fuel_type`: aggiungere `hvo` (unità litri) e colonna facoltativa `grade TEXT` (es. «100 ottani») | HVO e ottani sono citati come filtri mancanti nei concorrenti [FEA §18] |
| M-3 | `service_records.inspection_result TEXT CHECK (inspection_result IN ('regular','repeat','suspended'))`, valido solo se `kind = 'inspection'` | F-21 e flusso 6.3.6 punto 4 |
| M-4 | `vehicles.is_demo INTEGER NOT NULL DEFAULT 0` | F-17: l'auto di esempio si distingue, si può eliminare e **non entra nei backup** |
| M-5 | Vincolo applicativo (e, se possibile, trigger) per cui una sessione OBD con adattatore `simulator` si collega solo a un veicolo `is_demo = 1` | 6.3.5: la demo non sporca i dati reali |

**Modifica in V1** (migrazione `0002` con la ricetta di ricostruzione tabella [DAT §2.3]): profilo conducente per la patente (F-31) con `reminders.vehicle_id` annullabile per le scadenze personali.

### 8.3 Motore delle scadenze (dominio puro)

TypeScript puro in `src/domain`: nessun import da React, Expo o SQLite; nessuna lettura dell'orologio (`oggi` è un parametro); nessun fuso orario.

- **Tre concetti separati:** *regola* (`maintenance_items`: «olio ogni 15.000 km o 12 mesi»), *storico* (`maintenance_completions`: «fatto il 2026-03-01 a 40.000 km», annullabile), *occorrenza* (`reminders`: «il prossimo scade il…», con snooze e cache). Lo **stato** (ok, in arrivo, scaduto) non si salva: si calcola da `oggi` e dai km.
- **Invarianti testabili:** I1 al massimo un promemoria aperto per regola, polizza e rata; I2 il motore non modifica mai dati dell'utente (km, interventi, regole) ma solo le colonne cache dei promemoria *generati*; I3 nessun dato inventato (senza ingredienti il risultato è `unknown` con un codice motivo: `NO_LAST_DONE`, `NO_LAST_KM`, `NO_FIXED_DATE`, `NO_ODOMETER`, `RATE_TOO_LOW`, `FORECAST_BEYOND_10Y`); I4 funzione pura di (regola, ultimo fatto, letture km, oggi); I5 le cache si possono sempre buttare e ricostruire.
- **Tre tipi di regola:** `interval_last_done` (il primo fra ultimo fatto + mesi, con fine mese opzionale, e km ultimo fatto + intervallo); `interval_calendar` (serie che avanza di N mesi e **non scivola con il ritardo**: bollo e gomme); `fixed_date` (data fissa, poi «da configurare»).
- **Previsione dei km:** media km/giorno pesata per durata con decadimento esponenziale (emivita 90 giorni, finestra 180), segmenti sotto 7 giorni fusi, *winsorizing* a 3 volte la mediana pesata, restringimento verso un *prior* quando i dati coprono meno di 90 giorni (prior: stima dell'utente → media dalla prima immatricolazione → 12.000 km/anno **come ultima risorsa, etichettato «stima iniziale»** e a bassa confidenza); sotto 0,5 km/giorno l'auto è «ferma» e non c'è previsione; confidenza `high` con almeno 120 giorni e 4 punti, `medium` con 45 giorni e 3 punti, altrimenti `low`; scende di un livello se l'ultima lettura ha più di 60 giorni. I parametri vanno **tarati con dati reali** [DAT §3.4].
- **Completamento:** una transazione (validazione, lettura km, completamento con `prev_fixed_due_on`, promemoria a «fatto», riconciliazione, poi pianificazione notifiche). Il prossimo intervallo parte dai valori **reali** del completamento. L'«annulla» ripristina esattamente.
- **Snooze:** domani 09:00, 3 giorni, 1 settimana, «dopo N km» (con scadenza di sicurezza a 30 giorni); non cambia la scadenza e non si annulla se nel frattempo scade per km.
- **Ricorrenze dei promemoria manuali:** ancorate all'**origine** (31 gen, 28 feb, 31 mar…; 29 feb 2024 → 28 feb 2025 → 29 feb 2028); alla chiusura si crea la prima occorrenza dopo `max(scadenza, oggi)`.
- **Polizze e rate:** il promemoria nasce dalla polizza con `end_on` maggiore per tipo; le polizze precedenti passano a «fatto» (rinnovate); le rate non pagate generano promemoria (7, 1, 0 giorni). `splitInstallments`: n = 1, 2, 4, 12; importo base = `floor(premio/n)`, il resto sulla prima rata; scadenze a `start + k·12/n` mesi con clamp.
- **Riconciliazione idempotente** (`reconcileReminders`): dopo ogni scrittura che riguarda km, interventi, regole, polizze, rate, impostazioni; all'avvio e a ogni ritorno in primo piano; dal task in background come bonus.

### 8.4 Notifiche locali

Architettura a tre livelli: `planNotifications()` (puro: promemoria + «adesso locale» → candidate selezionate) · `syncNotifications()` (permesso → carica → piano → testo → differenza con il sistema → applica) · adattatore su `expo-notifications` (sottile, dietro la porta `NotificationScheduler`).

| Regola | Dettaglio |
|---|---|
| Trigger | **Solo `DATE`** con istanti calcolati dal dominio (identico su iOS e Android, testabile); mai trigger ricorrenti nativi |
| Chiave deterministica | `mg1:<reminderId>:<offset>`; `+N` per ripetizioni dopo la scadenza, `snz` per la fine dello snooze, `mg1:sentinel`, `mg1:test`; tutto ciò che non inizia per `mg1:` si ignora |
| Finestra | Massimo **60** notifiche pendenti (`notify.maxScheduled`), sotto il tetto iOS di 64; il limite di 64 è un vincolo di sistema documentato dai forum Apple, non da una pagina di documentazione; su Android esiste un tetto di circa 500 allarmi per app (codice AOSP) |
| Selezione | Ordina le candidate future per data, ora, rango (legale e assicurazione prima di manutenzione e controlli); se sono più di 60: riserva uno slot alla **sentinella** e fa due passate: la prossima notifica di *ogni* promemoria, poi le più vicine. Verificato in simulazione: 28 promemoria × circa 9 candidate → 60 notifiche, tutti i promemoria con almeno un avviso |
| Sentinella | «Apri l'app per aggiornare i tuoi promemoria», programmata all'istante della prima notifica rimasta fuori |
| Differenza idempotente | Hash di contenuto `fnv1a` calcolato su data, ora, canale, titolo e testo: se nulla cambia, **zero chiamate** al sistema (verificato) |
| Ripianificazione | Avvio e ritorno in primo piano (al massimo una volta al minuto); dopo ogni scrittura rilevante (coalescenza 1,5 s); task `mg-replan` in background (non garantito); ritorno dalle impostazioni; **cambio di fuso**; import/ripristino; tocco su notifica |
| Android | Canali: `deadlines` (alta), `maintenance` (default), `checks` (bassa), `system` (bassa), creati all'avvio; `POST_NOTIFICATIONS` chiesto in contesto; **nessun `SCHEDULE_EXACT_ALARM` né `USE_EXACT_ALARM`** (con Android 12+ senza il permesso, `expo-notifications` ripiega su `setAndAllowWhileIdle`: inesatto ma consegnato anche in Doze; riavvio gestito da `RECEIVE_BOOT_COMPLETED`); un arresto forzato cancella gli allarmi fino alla riapertura |
| iOS | Permesso esplicito (non provvisorio: consegna silenziosa inadatta a scadenze di legge); badge = promemoria scaduti o in arrivo non rimandati; niente livelli «time sensitive» |
| Contenuto | Titolo = nome della voce; corpo = «Panda: scade il 30/11/2026 (tra 14 giorni)»; soprannome e mai targa di default (`notify.privacy = generic`); nessun km nel testo |
| Task in background | `expo-background-task` (WorkManager / BGTaskScheduler, minimo 15 minuti, nessuna garanzia, non gira su simulatore iOS né dopo uno swipe dallo switcher): **solo bonus** |
| Ridondanza | Banner e «Da fare» in «Oggi» (fonte primaria), verifica notifiche, `.ics` (V1), widget (V1) |

Le 10 prove da fare su dispositivi reali (permessi, app chiusa, riavvio, cambio fuso, notti del cambio ora 25/10/2026 e 28/03/2027, oltre 64 candidate, risparmio energetico Xiaomi/Samsung, arresto forzato, aggiornamento, data di sistema cambiata) sono in SP-3 [DAT §4.11].

### 8.5 Backup, privacy e sicurezza

| Tema | Decisione |
|---|---|
| Formati | **ZIP completo** `MyGarage-AAAA-MM-GG.zip` (`manifest.json` con hash SHA-256 e dimensioni, `data.json`, `attachments/<ULID>.<ext>`, `csv/` facoltativi); **JSON versionato** (`format: "mygarage.backup"`, `formatVersion` separato da `schemaVersion`, catena di *upgrader* del formato, errori `BACKUP_TOO_NEW` e `NOT_A_BACKUP`); **CSV** solo in uscita |
| Cosa esporta | Tabelle utente; cestino escluso di default; dati di riferimento (officine, adattatori, categorie utente) sempre per intero; **esclusi** telemetria, `notification_schedule`, `pending_file_deletions`, `migrations_log`, cataloghi di sistema, impostazioni locali e **l'auto demo** |
| Importazione | *Sostituisci* e *Unisci* (upsert per `id`, vince `updated_at` più recente; non cancella mai); copia di sicurezza `VACUUM INTO` prima; transazione esclusiva con `defer_foreign_keys` e `foreign_key_check` finale: **qualsiasi violazione = rollback totale**; allegati copiati in cartella temporanea, hash verificato, spostati dopo il commit; dopo l'import si ricalcolano sempre le cache dei promemoria |
| Sicurezza dello ZIP | Rifiuta voci con `..`, percorsi assoluti, `\` o lettera di unità (*zip-slip*); un solo livello sotto `attachments/`; tetto di 2 GB; hash ricontrollati in lettura |
| CSV | Due varianti (Excel it-IT con `;`, BOM, `gg/mm/aaaa`, virgola decimale; dati con `,` e ISO); celle di testo che iniziano per `=`, `+`, `-`, `@`, tab o a capo ricevono un apice (*CSV injection*); importi in euro costruiti con aritmetica intera |
| Memoria | ZIP in memoria con `fflate` + foto ridimensionate in ingresso; compressore nativo (`react-native-zip-archive`, non verificato) solo se un utente reale supera la soglia |
| Cambio telefono | `android.allowBackup = false` (Auto Backup potrebbe ripristinare un file DB incoerente); si passa dal file di backup; guida passo-passo in app. iOS include i dati nel backup di sistema ma non è una garanzia |
| Cloud | **Nessuna sincronizzazione nell'MVP**; V1: backup automatico su cartella scelta dall'utente (selettore di sistema); V2: sync per riga end-to-end solo se emerge domanda. I dati calcolati (cache, notifiche, telemetria) non si sincronizzano mai; la sync di base non va mai a pagamento |
| Privacy | Nessun account, analytics, pubblicità, SDK di terzi che trasmettano dati; `redact()` centrale su targa e VIN nei log; logger silenzioso in release; rete: nessuna chiamata con dati dell'utente. L'esenzione domestica del GDPR (art. 2(2)(c)) è una valutazione di confidenza media: **serve il parere di un legale prima del rilascio** (domanda 2) |
| Cancellazione | `wipeAllData`: annulla notifiche e task, chiude il DB, elimina `.sqlite`, `-wal`, `-shm`, `attachments/`, `backups/`, cartelle temporanee, chiavi nel secure store, preferenze locali; verifica che la cartella dei documenti sia vuota; riparte dall'onboarding. Il `secure_delete` e `wal_checkpoint(TRUNCATE)` evitano residui |
| Cifratura | Cifratura del dispositivo sempre; **niente SQLCipher nell'MVP** (D-12); «protezione avanzata» in V2; allegati in chiaro nello storage privato |
| Blocco app | `expo-local-authentication` come gate d'interfaccia con ripiego sul codice del dispositivo; sempre bloccato dopo avvio a freddo; riblocco dopo il timeout in background; schermata neutra nello switcher; ri-autenticazione per esporta, cancella, disattiva il blocco; non copre notifiche, backup già condivisi, task in background |
| Store | Etichetta privacy Apple e *Data safety* Google «nessun dato raccolto» **solo se vero** (verificare ogni libreria); privacy policy in app e nei metadata (obbligatoria) |

### 8.6 Architettura a strati

Regola: il dominio non conosce nessuno; i casi d'uso conoscono solo le porte; gli adattatori implementano le porte; un solo punto (`bootstrap`) li collega.

| Strato | Cartella | Contiene | Può importare |
|---|---|---|---|
| **domain** (puro) | `mobile/src/domain/` | Tipi, date, unità, regole di scadenza, media km, ricorrenze, piano notifiche, consumi, formato di backup/CSV, **porte** (`SqlDatabase`, `Clock`, `IdGenerator`, `FileStore`, `NotificationScheduler`, `Authenticator`, `SecureKeyStore`, `ObdTransport`, `EventBus`) | solo se stesso |
| **usecases** | `mobile/src/usecases/` | `completeItem`, `addServiceRecord`, `addOdometerReading`, `reconcileReminders`, `syncNotifications`, `exportBackup`, `importBackup`, `wipeAllData`…: orchestrano dominio e porte, aprono le transazioni, emettono eventi | domain |
| **data** | `mobile/src/data/` | Adattatori SQL (`expo-sqlite`; `node:sqlite` solo test; `sql.js` per il web su PC), migrazioni, seed, repository con SQL a mano, backup, `AttachmentStore` | domain |
| **platform** | `mobile/src/platform/` | Notifiche, task in background, secure store, biometria, condivisione, selettore documenti, crypto, orologio | domain |
| **obd** | `mobile/src/obd/` | `protocol/` (parser e registro PID **puri**), `transport/` (BLE, Classic, Wi-Fi, simulato), `session/` | domain |
| **ui** | `mobile/src/ui/` e `mobile/src/app/` | Componenti, tema, `i18n/it.ts`, hook di lettura; **`src/app` è la cartella delle rotte di expo-router** (schermate sottili) | domain, usecases |
| **bootstrap** | `mobile/src/bootstrap/` | Composition root: costruisce gli adattatori e le dipendenze | tutto |

*Nota di riconciliazione (RC-13):* `data.md` chiama `src/app` lo strato dei casi d'uso, ma il template SDK 57 usa `src/app` per le rotte di expo-router. Lo strato dei casi d'uso si chiama quindi **`usecases`**.

Regole imposte da `dependency-cruiser` 18.5.0 (richiede TypeScript < 7: va bene il pin `~6.0.3`; con TypeScript 7.0.2 ha cruisato 0 moduli): `domain` importa solo `domain` (niente pacchetti npm); `usecases` solo `domain`; `data`, `platform`, `obd` non risalgono; `ui` non importa `data`, `platform`, `obd` (passa dai casi d'uso); niente cicli. Provata su un mini-progetto: 5 import sbagliati su 5 rilevati, nessun falso positivo.

**Struttura delle cartelle:**

```
AutoGarage/
  docs/                      SPEC.md, research/
  mobile/
    app.json  eas.json  babel.config.js  metro.config.js  tsconfig.json
    eslint.config.js  jest.config.js  vitest.config.ts  .dependency-cruiser.js
    assets/
    src/
      app/                   expo-router: SOLO rotte e navigazione
        _layout.tsx          provider radice: DB+migrazioni, i18n, tema, gestore notifiche
        (tabs)/              index (Oggi), garage, registro, impostazioni
        auto/[id]/           index, scadenze, registro, documenti, assicurazioni, obd, costi
      domain/                ports/ dates/ units/ odometer/ maintenance/ reminders/ fuel/ insurance/
                             tyres/ fluids/ costs/ diagnostics/ backup/
      usecases/
      data/                  db/ (open, pragmas, migrate, migrations/0001_init.ts) adapters/ repositories/ seeds/ backup/ files/
      platform/              notifications/ background/ security/ share/ crypto/ clock/
      obd/                   protocol/ transport/ session/
      ui/                    componenti, tema, i18n/it.ts, hook
      bootstrap/             root.ts
    tests/                   unit/ integration/ architecture/ fixtures/db/ fixtures/obd/
```

**Adattatori per ambiente** (un solo posto cambia tra «vero» e «simulato»: `bootstrap/root.ts`):

| Porta | Telefono (produzione) | Test su PC (Node) | UI su PC (Expo web) |
|---|---|---|---|
| `SqlDatabase` | `expo-sqlite` (transazioni esclusive con `withExclusiveTransactionAsync`) | `node:sqlite` | `sql.js` o in memoria (il web di `expo-sqlite` è alpha e richiede header COOP/COEP) |
| `Clock` | orologio del dispositivo | orologio fisso | orologio del browser |
| `FileStore` | `expo-file-system` | cartella temporanea | memoria |
| `NotificationScheduler` | `expo-notifications` | sistema operativo finto | stampa il piano in console |
| `Authenticator` | `expo-local-authentication` | finto | pulsante «sblocca» |
| `SecureKeyStore` | `expo-secure-store` | memoria | memoria |
| `ObdTransport` | BLE (poi Classic, Wi-Fi) reali | `MockTransport` con trascrizioni | `SimulatedTransport` |

**Accesso ai dati:** SQL a mano nei repository (D-05), che restituiscono **tipi di dominio** validati con `zod`; un solo oggetto `SqlDatabase` per processo; il task in background apre una **propria** connessione. Dopo il commit i casi d'uso emettono un evento di dominio; un sottoscrittore chiama `reconcileReminders` e `syncNotifications`. Nessun trigger SQL «intelligente»: la logica sta in codice testabile.

**Migrazioni:** solo in avanti, numerate 1..N, ognuna in una transazione esclusiva con `migrations_log` (checksum) e `PRAGMA user_version`; mai modificare una migrazione rilasciata; copia `VACUUM INTO` prima di migrare un DB con dati (si tengono le ultime 3); DB più nuovo dell'app → `SchemaTooNewError` e schermata «Aggiorna MyGarage»; cataloghi e impostazioni di default con upsert idempotente a ogni avvio; test CI con snapshot dello schema e fixture per ogni versione rilasciata.

**Sequenza di avvio:** 1) apri il DB e imposta i PRAGMA → 2) `migrate()` (errore → schermata di recupero) → 3) upsert dei cataloghi e delle impostazioni → 4) manutenzione (cestino oltre 30 giorni, coda di file da cancellare, retention della telemetria) → 5) `reconcileReminders()` e `planNotifications()` → 6) Home.

### 8.7 Strato OBD

Strati dal basso: **Transport** (interfaccia: `connect`, `write`, `onData`, `onClose`, `close`; implementazioni BLE, Classic, Wi-Fi, Mock) → **ElmSession** (coda FIFO con priorità, **un solo comando in volo**, accumulo fino al prompt `>`, normalizzazione di NUL, eco e `SEARCHING...`, timeout e retry per tipo, log grezzo con timestamp) → **AdapterInit** → **parser puri** → **VehicleService** (`readSnapshot`, `liveStream`, in V1 `clearDtc` con conferma) → dominio e SQLite.

**Regole di comunicazione** [OBD §6-§9, verificate sul datasheet ELM327]:
- Terminatore `CR`; attendere `>` prima del comando successivo (un carattere inviato durante un'operazione produce `STOPPED`). Mai dividere per notifica BLE: bufferizzare fino a `>`.
- Sequenza: `ATZ` (timeout 5 s) → `ATE0` (si toglie comunque l'eco, alcuni cloni la ignorano) → `ATL0` → `ATS0` → `ATH1` → `ATAT1` → `ATRV` → `ATSP0` → `0100` (timeout 15 s: ricerca del protocollo) → `ATDPN` (si memorizza il protocollo per auto e si riusa con `ATTP`, senza scrivere in EEPROM a ogni sessione) → `ATI`, `AT@1`, `STI`, sonda `ATAMC` → `0120`, `0140`… solo se il bit «puntatore» è 1 → `0902`.
- **`ATH1` + riassemblaggio ISO-TP proprio** (con `ATH0` le risposte di più centraline si mescolano): ID a 3 cifre (CAN 11 bit) o 8 (29 bit), PCI 0 = frame singolo, 1 = primo frame, 2 = consecutivo; raggruppamento per ECU; protocolli non-CAN con intestazione di 3 byte e checksum.
- Timeout consigliati: configurazione AT 1 s; Mode 01 2 s; `0902`, `03`, `07`, `0A` 3-5 s; Mode 04 5 s; inizializzazione K-line 8 s. Comandi di configurazione che rispondono `?` = «non supportato», senza abortire.
- I cloni «v1.5/v2.1» sono firmware v1.4: non dipendere da `ATCRA 7EX`, `ATAMT`, `ATCTM5`; gestire da soli le risposte `7F xx 78`.
- **Tabella dichiarativa dei PID** (`{pid, byte, decodifica, unità}`), lunghezza attesa verificata, risposte più corte scartate; **registro PID proprio** con `id`, `header ECU`, `richiesta`, `byte`, `formula`, `unità`, `verified_on`, `confidence`, `fonte`; popolato solo da PID verificati su auto reali o da fonti con licenza compatibile.
- **Bitmap dei PID:** «dichiarati» **e** «risposti almeno una volta» = supportati (alcune ECU dichiarano e poi rispondono `NO DATA`); unione delle maschere di più ECU; cache per VIN.
- **Live:** 4-8 Hz al massimo, PID scaglionati (giri e velocità a ogni ciclo, temperature ogni 10 cicli, tensione ogni 20); multi-PID (fino a 6) solo su CAN e solo in live; nessun polling in background; sessioni snapshot di 5-8 s per ~15 PID.
- **BLE:** selezione per proprietà (notify/write), lista nota di servizi (FFF0, FFE0, 18F0, Nordic UART, poi greedy su qualsiasi servizio non standard con una caratteristica notify e una write), notifiche abilitate **prima** del primo write, verifica con `ATZ` (nessun `>` in 3 s → configurazione successiva), configurazione ricordata per adattatore, MTU non assunta (si legge quella effettiva; i comandi ELM sono < 20 caratteri), riconnessione con backoff 1/2/4 s e **init completo** a ogni riconnessione.
- **Scrittura:** nell'MVP nessun comando di scrittura; in V1 solo Mode 04, protetto (5.5).
- **Licenze:** si usano come ispirazione solo progetti MIT/Apache/MPL con attribuzione e file `THIRD_PARTY_LICENSES`; **python-OBD (GPL-2.0), ELM327-emulator (CC BY-NC-SA 4.0) e l'app Android ELM327 Emulator (GPL-3.0) solo come strumenti esterni di sviluppo, mai incorporati**; non copiare tabelle di Wikipedia (CC BY-SA), né CSV di PID di comunità senza licenza.

**Test:** parser puri con **test «golden» su trascrizioni** `{cmd, rx[] (chunk BLE reali), atteso}` (sintetiche dagli esempi del datasheet e registrate da auto reali: OBDLink, clone v1.5, K-line, J1850 se disponibili), con scenari ATH0 e ATH1 (VIN CAN, VIN J1850, 1 e 3 codici, `0100` multi-ECU, `NO DATA`, `UNABLE TO CONNECT`, `STOPPED`); test di proprietà sul riassemblaggio ISO-TP (ordine casuale dei frame tra ECU); *fuzz* con dati casuali (il parser non lancia mai eccezioni: restituisce un errore tipizzato); `MockTransport` che riproduce le trascrizioni spezzate a 20 byte per provare il buffering.

### 8.8 Sviluppo su Windows senza Android SDK

| Livello | Come | Cosa prova | Cosa non prova |
|---|---|---|---|
| 1. Logica su Node | `npx vitest` (TypeScript puro) e `npx jest` (componenti con `jest-expo` + RNTL) | Parser OBD, scadenze, ripianificazione (data finta), validazioni, repository con `node:sqlite` | Rendering reale, BLE, notifiche di sistema |
| 2. Anteprima web | `npx expo start --web` (Metro + `react-native-web ~0.21`) con `SimulatedTransport` e dati in memoria o `sql.js` | Tutta l'interfaccia, navigazione, form, grafici, i18n | BLE, notifiche, permessi, biometria |
| 3. Expo Go su telefono | `npx expo login` + `npx expo start` | UI nativa, SQLite, notifiche locali, file, biometria | Moduli nativi extra (BLE, TCP, Classic). Expo Go richiede l'accesso all'account dal 3-9-2026 (per ora iOS) e **non è confermato per SDK 57 su Google Play** |
| 4. Development build via EAS (cloud) | `eas build --platform android --profile development` + `npx expo start --dev-client` | BLE reale, TCP reale, tutto | — (15 build Android + 15 iOS al mese nel piano gratuito, coda a bassa priorità) |

La scelta del trasporto è in una factory `createTransport(kind)`: `SimulatedTransport` su web, in Expo Go e con `EXPO_PUBLIC_OBD_MOCK=1`; il modulo reale si carica con `require` dinamico dentro la factory, così Expo Go e web non importano moduli nativi assenti.

## 9. Stack e versioni verificate

Data di verifica: **2026-10-07** (`npm view` per tutte le versioni «latest»; per i pacchetti legati all'SDK la colonna «Versione da usare» viene da `bundledNativeModules.json` di `expo@57.0.27`, la tabella che usa `npx expo install`) [STK §7]. Ambiente dello sviluppatore: Windows 11, Node 24.19.0 (soddisfa `engines` di React Native 0.86.3: `^24.3.0`), npm 11.17.0, nessun Java, Android SDK o Xcode.

**Fonti (URL):** registro npm (`npm view`, 2026-10-07) · https://expo.dev/changelog/sdk-57 · https://expo.dev/changelog · https://expo.dev/pricing · https://reactnative.dev/blog/2025/10/08/react-native-0.82 · https://docs.expo.dev/more/create-expo/ · https://support.google.com/googleplay/android-developer/answer/14151465 · https://developer.android.com/developer-verification · https://developer.apple.com/news/upcoming-requirements/. Confidenza: **alta** sulle versioni e sulla risoluzione delle dipendenze (nessun conflitto `ERESOLVE`, una sola copia di `react` e `react-native`); **media-bassa** sul funzionamento delle librerie native su hardware.

### 9.1 Scelta

**Expo SDK 57 (`expo ~57.0.27`, rilasciato il 30-6-2026) + React Native 0.86.3 + React 19.2.3 + TypeScript ~6.0.3**, New Architecture (unica possibile da RN 0.82), `expo-router ~57.0.25` con cartella `src/app`, **development build via EAS Build nel cloud** e config plugin. Confidenza media-alta: regge tutti i vincoli duri (Windows senza SDK, build nel cloud, anteprima web con OBD simulato, sviluppatore singolo); il punto debole sono le librerie native di terze parti su RN 0.86, che nessuna ricerca ha provato su hardware (SP-4, SP-5, SP-6).

Alternative scartate [STK §2]: **Flutter 3.47** (richiede l'Android SDK per compilare localmente; `flutter_blue_plus` impone una licenza commerciale alle organizzazioni a scopo di lucro, anche in sviluppo, e invia telemetria di licenza in fase di build; ripiego `flutter_reactive_ble` BSD-3) e **nativo Kotlin+Swift** (due codebase, richiede Android Studio e macOS). **Non si adotta SDK 58** (beta dal 15-9-2026; si migra con `npx expo install expo@^58 --fix` dopo la stabile).

### 9.2 Versioni da usare

**Base e interfaccia**

| Pacchetto | Versione | Nota |
|---|---|---|
| `expo` | ~57.0.27 | `latest` su npm = 57.0.27; `next` = 58.0.6 (beta: da evitare) |
| `react`, `react-dom` | 19.2.3 | SDK 57 fissa 19.2.3 |
| `react-native` | 0.86.3 | **non** 0.87.1 |
| `react-native-web` | ~0.21.0 | anteprima web |
| `expo-router` | ~57.0.25 | rotte file-based con typed routes |
| `typescript` | ~6.0.3 | come il template; **non** 7.0.2 |
| `react-native-screens` | ~4.26.0 | |
| `react-native-safe-area-context` | ~5.7.0 | |
| `react-native-gesture-handler` | ~2.32.0 | **non** 3.x |
| `react-native-reanimated` / `react-native-worklets` | 4.5.1 / 0.10.1 | |
| `react-native-svg` | 15.15.4 | grafici |
| `@shopify/flash-list` | 2.0.2 | liste lunghe (timeline) |
| `expo-dev-client`, `expo-build-properties` | ~57.0.19, ~57.0.22 | necessari per le development build |
| `expo-linear-gradient` | ~57.0.2 | peer dei grafici |
| `@react-native-community/datetimepicker` | 9.1.0 | quella dell'SDK (non 9.2.1) |

**OBD e comunicazione**

| Pacchetto | Versione | Ruolo | Confidenza |
|---|---|---|---|
| `react-native-ble-manager` | 12.5.3 (Apache-2.0, rilasciata il 21-9-2026) | **BLE primario** (TurboModule, New Architecture, plugin Expo, 7 issue aperte) | media (**non provata su RN 0.86**: SP-4) |
| `react-native-ble-plx` | 3.5.1 (ultimo rilascio 18-2-2026; ultimo commit 9-3-2026) | Ripiego: modulo legacy tramite interop; issue #1277/#1278 (crash iOS in release con `null`) e #1323 aperte; con `patch-package` | media-bassa |
| `react-native-bluetooth-classic` | 1.73.0-rc.17 (solo release candidate, 19-11-2025) | Classic Android, **V1, opzionale e isolato**; nessun plugin Expo (serve un plugin locale per i permessi) | **bassa** (SP-5) |
| `react-native-tcp-socket` | 6.4.3 (10-9-2026) | Wi-Fi ELM327 (V1); modulo legacy a bridge, senza plugin Expo | media-bassa (SP-6) |

Piano B se le librerie BLE risultassero instabili (tutto in Expo): un piccolo **Expo Module** nativo in Kotlin/Swift compilato da EAS nel cloud; oppure il fork `@sfourdrinier/react-native-ble-plx` 3.9.3 (TurboModule, ma di un solo maintainer e con circa 2.600 download/settimana). In `package.json` va **una sola** libreria BLE per volta nelle build di produzione.

**Dati, file, sicurezza, sistema**

| Pacchetto | Versione | Uso |
|---|---|---|
| `expo-sqlite` | ~57.0.4 | Database locale (SQL a mano; nessun ORM) |
| `zod` | 4.6.5 | Validazione delle righe e dei form |
| `fflate` | 0.8.3 | ZIP del backup (in memoria) |
| `ulid` | 3.0.2 | Identificatori (porta `IdGenerator`; la sorgente casuale su Hermes va verificata: ripiego `expo-crypto`) |
| `expo-file-system` | ~57.0.7 | API a oggetti `File`/`Directory` (le vecchie API in `expo-file-system/legacy`) |
| `expo-document-picker`, `expo-image-picker`, `expo-sharing` | ~57.0.3, ~57.0.20, ~57.0.22 | Import, foto e documenti, condivisione del backup |
| `expo-secure-store`, `expo-local-authentication`, `expo-crypto` | ~57.0.4, ~57.0.3, ~57.0.3 | Chiavi, blocco app, casualità |
| `expo-localization`, `expo-device`, `expo-keep-awake`, `expo-intent-launcher` | ~57.0.2, ~57.0.2, ~57.0.2, ~57.0.1 | Lingua, diagnostica, schermo acceso in live, impostazioni batteria Android |
| `expo-print` (V1: PDF rivendita), `expo-screen-capture` (opzionale con il blocco app) | ~57.0.2, ~57.0.4 | |

**Notifiche e background**

| Pacchetto | Versione | Nota |
|---|---|---|
| `expo-notifications` | ~57.0.22 | Notifiche locali; `POST_NOTIFICATIONS` e `RECEIVE_BOOT_COMPLETED` dichiarati dalla libreria; **non** dichiara `SCHEDULE_EXACT_ALARM` |
| `expo-background-task`, `expo-task-manager` | ~57.0.21, ~57.0.21 | Solo ripianificazione opportunistica |

**Stato, form, lingua, grafici**

| Pacchetto | Versione |
|---|---|
| `zustand` | 5.0.15 (stato della UI e della sessione OBD, non dei dati persistenti) |
| `react-hook-form` / `@hookform/resolvers` | 7.89.0 / 5.9.1 |
| `i18next` / `react-i18next` | 26.4.2 / 17.0.16 |
| `date-fns` | 4.4.0 (locale `it`, solo per testi lunghi; il calcolo delle scadenze usa funzioni proprie sulle date di calendario) |
| `react-native-gifted-charts` | 1.4.81 (SVG, funziona anche su web) |

**Test e qualità** (non dipendenze di produzione)

| Strumento | Versione | Nota |
|---|---|---|
| `vitest` | 5.0.3 | TypeScript puro su Node: dominio, dati con `node:sqlite`, parser OBD |
| `jest` / `jest-expo` / `@types/jest` | ~29.7.0 / ~57.0.5 / ~29.5.14 | **Jest 29**: `jest-expo` 57 dipende da Jest 29 (non usare Jest 30.5.2) |
| `@testing-library/react-native` / `test-renderer` | 14.0.1 / 1.3.0 | Componenti |
| `dependency-cruiser` | 18.5.0 | Regole di dipendenza (TypeScript < 7) |
| `sql.js` | 1.14.2 | Database per l'anteprima web su PC |
| `eslint` / `eslint-config-expo` / `prettier` | ^9.39.5 / ~57.0.2 / 3.9.9 | ESLint 9 per prudenza |
| `eas-cli`, `create-expo-app` | 24.11.0, 5.0.0 | Strumenti (non dipendenze) |

### 9.3 Versioni da NON usare con SDK 57

`react-native` 0.87.1 · `react` 19.3.0 · `react-native-gesture-handler` 3.3.0 · `react-native-reanimated` 4.7.1 · `react-native-worklets` 0.13.0 · `react-native-screens` 4.28.0 · `react-native-safe-area-context` 5.10.1 · `@shopify/flash-list` 2.3.3 · `typescript` 7.0.2 · `jest` 30.5.2 · `eslint` 10.12.0 · `expo-sqlite@next` (58.0.10) · `@react-native-community/datetimepicker` 9.2.1 · Drizzle 1.0 RC. Un `npm install <pacchetto>@latest` può rompere la build nativa. **Regola:** i pacchetti Expo e nativi si installano **solo** con `npx expo install`; prima di ogni build EAS si esegue `npx expo install --check` (deve segnalare 0 incompatibili) e `npx expo-doctor`.

### 9.4 Scaffolding (PowerShell, dalla cartella del progetto)

```powershell
npx create-expo-app@latest mobile --template default@sdk-57 --no-install
cd mobile
npm install
npx expo --version            # atteso: 57.0.x
npm run reset-project         # sposta il demo in app-example/ e lascia src/app/index.tsx vuoto

npx expo install expo-dev-client expo-build-properties expo-sqlite expo-notifications expo-file-system expo-document-picker expo-image-picker expo-sharing expo-secure-store expo-local-authentication expo-localization expo-background-task expo-task-manager expo-device expo-crypto expo-keep-awake expo-intent-launcher expo-linear-gradient @react-native-community/datetimepicker @shopify/flash-list react-native-svg

npm install react-native-ble-manager@12.5.3 zustand@5.0.15 react-hook-form@7.89.0 @hookform/resolvers@5.9.1 zod@4.6.5 i18next@26.4.2 react-i18next@17.0.16 date-fns@4.4.0 react-native-gifted-charts@1.4.81 fflate@0.8.3 ulid@3.0.2

npm install -D jest-expo@~57.0.5 jest@~29.7.0 @types/jest@~29.5.14 @testing-library/react-native@14.0.1 test-renderer@1.3.0 vitest@5.0.3 prettier@3.9.9 dependency-cruiser@18.5.0 sql.js@1.14.2

npx expo lint                 # configura eslint ^9 + eslint-config-expo alla prima esecuzione
npx expo install --check      # deve segnalare 0 pacchetti incompatibili
npx expo-doctor
```

La sintassi `--template default@sdk-57` è confermata dal sorgente di `create-expo@5.0.3` (non dalla documentazione); il tag va **fissato** perché `latest` passerà a SDK 58 alla stabile. `create-expo-app` genera anche `AGENTS.md` e `.claude/settings.json` (utili con Claude Code; `--no-agents-md` per escluderli). Se serve `@react-native/jest-preset ^0.86.3` come peer di `jest-expo`, va aggiunto esplicitamente.

### 9.5 Configurazione dell'app (estratto di `app.json`)

```json
{
  "expo": {
    "name": "MyGarage",
    "slug": "mygarage",
    "scheme": "mygarage",
    "plugins": [
      "expo-router",
      "expo-splash-screen",
      "expo-sqlite",
      ["react-native-ble-manager", {
        "bluetoothAlwaysPermission": "MyGarage usa il Bluetooth per leggere i dati dall'adattatore OBD-II della tua auto.",
        "neverForLocation": true,
        "isBleRequired": false
      }],
      ["expo-notifications", { "defaultChannel": "deadlines" }]
    ],
    "android": { "allowBackup": false },
    "experiments": { "typedRoutes": true, "reactCompiler": true }
  }
}
```

**Da NON aggiungere nell'MVP:** `UIBackgroundModes` (`bluetooth-central`), servizi in primo piano Android (`connectedDevice`), `SCHEDULE_EXACT_ALARM`, `USE_EXACT_ALARM`, permessi di posizione (il plugin li limita a Android 11 e precedenti con `neverForLocation`). **Da aggiungere in V1 con il Wi-Fi:** `ios.infoPlist.NSLocalNetworkUsageDescription` (nessun plugin lo fa). Il plugin `react-native-ble-manager` non gestisce `UIBackgroundModes`; per le altre librerie le stringhe di permesso si aggiungono quando `expo-doctor` o la build le richiedono. `eas.json` con tre profili (`development` con `developmentClient: true` e APK, `preview` APK, `production` con `autoIncrement`).

Permessi Bluetooth Android generati: `BLUETOOTH`, `BLUETOOTH_ADMIN` (solo fino ad Android 11), `BLUETOOTH_SCAN` con `neverForLocation`, `BLUETOOTH_CONNECT`. Soglie di piattaforma: Android `minSdk` 24 e `targetSdk` 36 e iOS 16.4 sono i valori predefiniti letti nei pacchetti di SDK 57 (valori di ripiego: **il `targetSdkVersion` effettivo si controlla sul primo build**, SP-7).

### 9.6 Account, costi e vincoli degli store

| Voce | Costo | Requisiti e note |
|---|---|---|
| Expo / EAS Free | 0 USD | 15 build Android + 15 iOS al mese, coda a bassa priorità, concorrenza 1; EAS Submit incluso; Starter 19 USD/mese (45 USD di crediti); pay-as-you-go 1 USD (Android) e 2 USD (iOS) per build medium |
| Google Play Console | **25 USD una tantum** | Età minima 18 anni, documento d'identità e carta a nome legale, verifica del dispositivo con l'app Play Console. **Account personali nuovi: closed test obbligatorio con almeno 12 tester iscritti per almeno 14 giorni consecutivi** prima di chiedere la produzione (pianificare 2-3 settimane) |
| Apple Developer Program | **99 USD/anno** | Indispensabile per provare su iPhone, TestFlight (100 tester interni, fino a 10.000 esterni, build valide 90 giorni) e App Store; le build iOS si fanno su EAS (nessun Mac); le app caricate dal 28-4-2026 richiedono Xcode 26 e SDK iOS 26 ([DA VERIFICARE] che l'immagine EAS per SDK 57 li includa) |
| Android developer verification | Gratuita per gli hobbisti | Google richiede la verifica dell'identità dello sviluppatore per le app su dispositivi certificati: dal 30-9-2026 in Brasile, Indonesia, Singapore, Thailandia; **globalmente nel 2027 (quindi in Italia)**. L'account Play Console copre la registrazione; esiste un account a distribuzione limitata (fino a 20 dispositivi). Impatta gli APK interni EAS dal 2027 |
| Play: target API | — | Dal 31-8-2026 le nuove app richiedono `targetSdk` ≥ 36 (estensione richiedibile fino al 1-11-2026) |
| Privacy policy | — | Obbligatoria in entrambi gli store (guideline 5.1.1(i) di Apple) |
| Costo minimo del primo anno | circa 124 USD (25 + 99); solo Android: 25 USD | EAS Free può bastare per un singolo sviluppatore con pochi rilasci |

## 10. Requisiti non funzionali

Le soglie sono **obiettivi di progetto**: dove non esiste ancora una misura (nessun codice né dispositivo) la colonna «Come si verifica» dice quando e come si misura. Nessuna soglia di prestazione è stata misurata finora.

| ID | Requisito | Soglia | Come si verifica |
|---|---|---|---|
| NFR-01 | **Offline-first.** Tutte le funzioni P0 funzionano senza rete, comprese quelle OBD via BLE | 100% delle P0 in modalità aereo; nessuna richiesta di rete con dati dell'utente in release | Prova manuale in modalità aereo; ispezione del traffico di una build di release (proxy) in Fase 2. [SPIKE SP-7] valutare di **non dichiarare il permesso `INTERNET`** su Android nell'MVP (nessun trasporto Wi-Fi), per dimostrare «zero rete» |
| NFR-02 | **Privacy.** Nessun analytics, pubblicità, tracker o SDK che trasmetta dati; notifiche senza targa di default; log con `redact()` | 0 librerie di tracciamento; etichette store «nessun dato raccolto» veritiere | Revisione di `npm ls` e licenze a ogni rilascio; test automatico su `redact()`; lettura del manifest e del plist finali |
| NFR-03 | **Integrità dei dati.** Nessuna perdita per crash, kill del processo, migrazione o import | Ogni scrittura in transazione; `integrity_check` = ok e `foreign_key_check` vuoto dopo ogni scenario di test; import con rollback totale | Test su DB reale con kill durante il salvataggio; fixture per ogni versione dello schema; test di ripristino da backup (round-trip identico `export(import(export(DB)))`) |
| NFR-04 | **Affidabilità delle notifiche.** Una scadenza non si perde | 100% dei promemoria con almeno un avviso nel piano; consegna entro 15 minuti dall'ora prevista sui dispositivi di prova in condizioni normali; con risparmio energetico aggressivo vale la ridondanza in app (banner, «Verifica notifiche») | Le 10 prove di SP-3 su almeno un Android 13+, un Android 12, un Xiaomi o Samsung e un iPhone |
| NFR-05 | **Accessibilità: percezione.** WCAG 2.2 livello AA come obiettivo | Contrasto ≥ 4,5:1 per il testo normale e ≥ 3:1 per testo grande e icone, anche nel tema scuro; bersagli ≥ 44 pt (iOS) / 48 dp (Android) | Verifica dei token di colore con calcolatore di contrasto; ispezione manuale dei bersagli |
| NFR-06 | **Accessibilità: testo e layout.** Il testo si ingrandisce senza perdere funzioni | Fino al 200% senza troncamenti né sovrapposizioni; layout valido da 320 dp di larghezza; azioni principali raggiungibili con una mano (barra in basso) | Prove con Dynamic Type e dimensione carattere Android al massimo |
| NFR-07 | **Accessibilità: uso.** Nessuna informazione solo a colore; lettori di schermo; grafici con alternativa | Semafori sempre con icona e testo; 100% dei controlli con etichetta e ruolo; ogni grafico ha una tabella equivalente; animazioni ridotte se richiesto dal sistema; messaggi in italiano semplice; interfaccia OBD pensata per auto ferma | Percorsi con VoiceOver e TalkBack su: aggiungere un'auto, registrare un rifornimento, completare una scadenza, esportare un backup, collegare l'OBD in demo. *Nota normativa:* l'European Accessibility Act è applicabile dal 28-6-2025 con esenzione per le microimprese di servizi (meno di 10 addetti e fino a 2 milioni di EUR); **se l'editore è un'azienda non microimpresa l'obbligo potrebbe applicarsi: confidenza bassa, da chiarire con il legale** (domanda 2) |
| NFR-08 | **Prestazioni.** | Avvio a freddo fino a «Oggi» ≤ 2,0 s su un telefono di fascia media; inserimento di un rifornimento ≤ 10 s e ≤ 8 tocchi per un utente esperto; query di «Oggi» < 50 ms con 10.000 righe; scorrimento a 60 fps con 5.000 eventi in timeline (FlashList); export di 10.000 righe + 200 foto ≤ 30 s con picco di memoria ≤ 300 MB; snapshot OBD ≤ 15 s tipico su CAN; live a 4-8 Hz | Misure su dispositivo di fascia media in Fase 1 (avvio, query, scorrimento) e Fase 2 (OBD); profili del DB di prova con dati sintetici |
| NFR-09 | **Localizzazione it-IT.** | Date `gg/mm/aaaa` (settimana da lunedì); numeri `1.234,56`; valuta `1.234,56 €`; km `123.456`; prezzo al litro con 3 decimali; consumo in L/100 km (km/L selezionabile); input che accetta virgola e punto; plurali corretti; nessuna stringa concatenata; terminologia dell'appendice A; **nessuna stringa in altra lingua**, compresi codici DTC e categorie | Test automatici su `parseEuroToCents`, `parseMilli`, `formatDateIt`, `formatEuro`; revisione di tutte le stringhe; prova con tastiere iOS e Android |
| NFR-10 | **Compatibilità.** | iOS 16.4 o successivo; Android 7.0 (API 24) o successivo; `targetSdk` 36; telefoni da 320 dp; verticale come orientamento principale. Valori predefiniti di SDK 57 | Controllo di `aapt dump badging` sul primo build EAS (SP-7); prove su un Android 8-11 (permessi BLE diversi) e un Android 12+ |
| NFR-11 | **Sicurezza.** | Allegati solo nello storage privato; nessun segreto nei log; blocco app con ri-autenticazione per esporta/cancella; zip-slip e CSV injection bloccati; `android.allowBackup = false`; **nessuna dipendenza GPL/AGPL/CC-NC incorporata** | Test automatici sullo ZIP costruito ad arte e sul CSV; revisione licenze a ogni rilascio (`THIRD_PARTY_LICENSES`) |
| NFR-12 | **Manutenibilità e testabilità.** | `domain` e `obd/protocol` con copertura di linee ≥ 90%; 0 violazioni di `dependency-cruiser`; TypeScript in modalità `strict`; nessun `any` in `domain`; ESLint senza errori; aggiornamento all'SDK Expo successivo entro 2 mesi dalla sua uscita stabile | CI locale (`vitest`, `jest`, `tsc`, `dependency-cruiser`, `expo lint`) a ogni integrazione |
| NFR-13 | **Conformità agli store.** | Privacy policy in app e nei metadata; etichette *App Privacy* e *Data safety* corrette; testi dei permessi in italiano e specifici; **modalità demo + video con hardware reale** per App Review; `targetSdk` ≥ 36; build con Xcode 26+; nessuna modalità in background Bluetooth | Checklist di pre-rilascio (sezione 12, Fase 4) |
| NFR-14 | **Supporto e trasparenza.** | Pagina «Stato del progetto» con data dell'ultimo aggiornamento, contatto e tempo di risposta dichiarato (proposta: entro 5 giorni lavorativi); promessa pubblica «se smettiamo di aggiornare, l'esportazione resta»; nessuna revoca di licenze | Revisione a ogni rilascio |
| NFR-15 | **Resilienza OBD.** Nessun crash né blocco per risposte sporche o disconnessioni | Il parser non lancia mai eccezioni (restituisce un errore tipizzato); nessun ritentativo infinito (massimo 3 riconnessioni con backoff); un solo comando in volo; mai blocco dell'interfaccia durante la ricerca del protocollo | *Fuzz* e test golden su trascrizioni; scenari del simulatore (clone, K-line lenta, auto spenta, disconnessione) |

## 11. Criteri di accettazione delle funzionalità P0

Ogni criterio è verificabile. «Auto» = test automatico su PC (vitest/jest, senza dispositivo); «Disp.» = prova su telefono o auto reali; «Man.» = prova manuale con cronometro o lista di controllo. I vettori numerici provengono dalle ricerche (`regs.md`, `data.md`, `obd.md`), dove sono stati ricalcolati sia a mano sia con script indipendenti; qui sono **obbligatori come test**.

| ID | Funzioni | Criteri di accettazione | Verifica |
|---|---|---|---|
| **AC-01** | F-01, F-02, F-05 | 1) Si salva un'auto con solo marca, modello e alimentazione primaria. 2) Targa e VIN vengono normalizzati (maiuscolo, senza spazi); una targa uguale a quella di un'auto non eliminata dà errore comprensibile; dopo l'eliminazione definitiva o nel cestino la targa è riusabile. 3) Nessun limite al numero di auto (prova con 50). 4) L'eliminazione richiede conferma con il nome, manda l'auto nel cestino per 30 giorni e permette il ripristino; «Elimina definitivamente» cancella a cascata righe e file (coda `pending_file_deletions` svuotata). 5) Un'auto non attiva non genera promemoria né notifiche | Auto |
| **AC-02** | F-03 | 1) Letture 10.000 km (2026-01-01), 15.000 (2026-06-01), 12.000 (2026-03-01, retrodatata): accettate. 2) 16.000 km il 2026-03-02 e 14.000 il 2026-07-01: rifiutate con `ODO_NON_MONOTONIC` e la UI offre *Correggi*, *Salva senza aggiornare i km*, *È un errore della lettura precedente*. 3) Due letture nello stesso giorno: nessun vincolo; una lettura `ignored` esce da calcoli e controlli. 4) Ogni km mostrato porta la provenienza (letto/stimato/inserito). 5) Media km/giorno: 20 giorni di dati (30.000 km il 17-9, 30.400 il 7-10, stima utente 12.000 km/anno) → 30,015 km/g, `low`; auto con 5.000 km invariati in 180 giorni → nessuna previsione; la gita breve dell'esempio [DAT §3.4] → 37,13 km/g con *clamp* | Auto |
| **AC-03** | F-19, F-20, F-23, F-24, F-25, F-26 | 1) Superano tutti i **53 vettori** del motore [DAT §3.10] e i vettori M1-M6 [REG §9.4]. 2) «Il primo dei due»: olio 15.000 km/12 mesi, ultimo a 42.000 km il 2025-10-01, ora 55.000 km il 2026-10-07 → `dueKm` 57.000, `dueDate` 2026-10-01, scaduto per il limite dei mesi. 3) «Non lo so» nel wizard non crea promemoria né notifiche (stato *Da configurare*). 4) Completare con data e km reali ricalcola il prossimo dai valori reali; «annulla» ripristina esattamente `fixed_due_on`. 5) Serie di calendario che non scivola: bollo con scadenza 2026-08-31 pagato il 10-8, il 2-10 e il 2028-01-10 → prossima 2027-08-31, 2027-08-31, 2028-08-31. 6) Una scadenza a km avanza col tempo anche se nessuno aggiorna l'odometro (diventa «Probabilmente scaduta (stima)»). 7) Snooze nasconde dalla lista e dalle notifiche fino alla fine, non cambia la scadenza. 8) Stato rosso per *scaduta* e *scade oggi*, con icona e testo | Auto |
| **AC-04** | F-21, F-22 | 1) Vettori **R1-R9**, **B1-B7**, **B13**, **B14** (sezione 7) passano. 2) Con `manualDueBy` il calcolo è ignorato. 3) Il campo del bollo si chiama «Mese di pagamento» e il testo guida distingue «scadenza» da «termine di versamento». 4) Nessun importo di bollo viene calcolato; compaiono i link a ACI, pagoPA, app IO. 5) Auto a benzina o gasolio con `power_kw ≤ 80` e scadenza 2027: etichetta «Possibile esenzione 2027» e promemoria **non** cancellato. 6) Le regole hanno `validFrom`, `source`, `confidence`, `lastVerified` visibili nella scheda. 7) Le avvertenze della sezione 7 sono mostrate | Auto + Man. |
| **AC-05** | F-52, F-53 | 1) Una polizza RC con scadenza 2026-03-10 genera promemoria a 30, 14, 7, 1 e 0 giorni. 2) Vettori **A1-A6** passano (tolleranza solo informativa; il promemoria non si sposta). 3) «Rinnova» crea una nuova polizza collegata con decorrenza proposta = scadenza precedente; la vecchia diventa *rinnovata* e il suo promemoria si chiude. 4) Senza scadenza inserita, il valore decorrenza + 12 mesi è etichettato «stimata». 5) Nessuna funzione di rinnovo tacito | Auto |
| **AC-06** | F-35, F-36, F-37 | 1) Un intervento si registra in meno di 60 secondi (tipo, data, km, officina, totale). 2) «Cosa hai fatto?» propone le voci attive pre-selezionate e crea un completamento per ognuna; il testo del prossimo cambio olio dice «il primo dei due». 3) Un intervento con olio incluso nel tagliando non crea doppioni. 4) Eliminare l'intervento annulla i suoi completamenti e riapre il promemoria nella stessa transazione. 5) Revisione con esito *regolare* → scadenza a fine mese di (data + 24 mesi); *da ripetere* → promemoria entro un mese; *sospesa* → avviso senza dichiarazioni di circolazione. 6) Totale e righe in centesimi interi, nessun *float* | Auto + Man. |
| **AC-07** | F-39, F-41, F-42 | 1) Con due campi tra litri, €/litro e totale si calcola il terzo: 40,000 L × 1,859 €/L = 74,36 €; 35,500 L × 1,789 = 63,5095 → 6351 centesimi. 2) Scarto oltre 2 centesimi: richiesta di conferma, non blocco. 3) `parseEuroToCents('1.234,56') = 123456`; accetta `1,234.56`, `1234,56`, `EUR 12,50`; rifiuta `12,345`, `1.2.3`, `12,5,5` (nessun arrotondamento silenzioso). 4) Km non crescente: avviso non bloccante con le tre scelte di AC-02. 5) Consumo calcolato pieno-a-pieno, **per carburante** nelle auto bifuel; pieno parziale e «ho saltato un rifornimento» gestiti. 6) Costi: nessun doppione tra interventi, rifornimenti, spese e rate pagate. 7) Dal foglio aperto al salvataggio ≤ 10 s e ≤ 8 tocchi per un utente esperto | Auto + Man. |
| **AC-08** | F-44 | 1) Un controllo si registra in 3 tocchi (fluido, esito, salva). 2) Quantità e prodotto solo con «Rabboccato» (`added_ml` valido solo con `topped_up`). 3) La pressione dei pneumatici è tra i fluidi (modifica M-1). 4) Registrare un controllo completa il promemoria di controllo collegato e, se si inseriscono i km, crea una lettura. 5) Il riquadro «Letto dall'auto» è assente se non esiste una sessione OBD e, se presente, mostra la data e l'etichetta «Letto dall'auto». 6) I testi guida di olio e pressione sono presenti | Auto + Man. |
| **AC-09** | F-04, F-47, F-48 | 1) Foto, galleria e PDF si aggiungono ai documenti e restano nello storage privato (non compaiono nella galleria del telefono). 2) Le foto sono ridimensionate (lato lungo 2048 px, JPEG circa 80%) e hanno SHA-256. 3) Un allegato ha un solo genitore; path traversal rifiutato. 4) La timeline unisce rifornimenti, interventi, spese, controlli, snapshot OBD e documenti, ordinati per data, con filtri per tipo e periodo. 5) Con il blocco app attivo i documenti richiedono lo sblocco | Auto + Man. |
| **AC-10** | F-27, F-28 | 1) Il piano contiene al massimo 60 notifiche; con 28 promemoria × circa 9 candidate **tutti i 28** hanno almeno una notifica e la sentinella è programmata all'istante della prima esclusa. 2) La seconda sincronizzazione senza modifiche produce **0 operazioni**; completare un promemoria cancella solo le sue notifiche. 3) Con permesso negato non si chiama lo scheduling; compare il banner e «Oggi» resta la fonte primaria. 4) Il testo non contiene targa (default) né km; le scadenze a km sono «stimate». 5) 25-10-2026 09:00 locale → 08:00Z; 28-3-2027 09:00 → 07:00Z; ora inesistente 28-3-2027 02:30 → 03:30 CEST (da confermare su Hermes, SP-2). 6) Un cambio di fuso al ritorno in primo piano fa ripianificare tutto. 7) «Verifica notifiche» mostra permesso, canali, attese contro presenti, prossima notifica e invia la prova a 10 s. 8) Le 10 prove su dispositivo di SP-3 sono eseguite e registrate | Auto (1-6) + Disp. (7-8) |
| **AC-11** | F-06, F-07, F-08, F-09 | 1) `export(import(export(DB)))` produce un JSON identico. 2) ZIP con voce `../x`, percorso assoluto o `\` → `UNSAFE_PATH`; hash alterato → errore; manca `manifest.json` → `NOT_A_BACKUP`; `formatVersion` più alta → `BACKUP_TOO_NEW`. 3) *Unisci*: vince `updated_at` più recente, mai cancellazioni; *Sostituisci*: transazione unica; conflitto di targa (stessa targa, ULID diverso) → **rollback totale**. 4) Copia di sicurezza automatica prima dell'import; «Annulla importazione» ripristina. 5) CSV: celle di testo che iniziano per `=`, `+`, `-`, `@` ricevono un apice; la variante italiana usa `;`, BOM e virgola decimale. 6) Banner di backup dopo 30 giorni e almeno 5 modifiche. 7) `wipeAllData` lascia vuota la cartella dei documenti dell'app e l'app riparte dall'onboarding; l'avviso sui backup già condivisi è mostrato. 8) L'auto demo non entra nel backup | Auto + Man. |
| **AC-12** | F-11, F-12, F-13, F-14, F-15, F-16, F-18 | 1) Con un utente nuovo, dall'apertura alla prima scadenza visibile in «Oggi» ≤ 2 minuti. 2) Il permesso notifiche è chiesto solo dopo la prima scadenza; il permesso Bluetooth solo al tocco su «Collega auto». 3) I semafori usano sempre icona e testo; contrasti ≥ 4,5:1 nei temi chiaro e scuro. 4) Con il testo al 200% nessun troncamento nelle schermate S-10, S-12, S-22, S-24, S-31, S-55. 5) I 5 percorsi di NFR-07 sono completabili con VoiceOver e TalkBack. 6) I formati it-IT (NFR-09) sono rispettati ovunque. 7) Privacy policy e licenze sono raggiungibili in al massimo 2 tocchi da Impostazioni; la versione e la data dell'ultimo aggiornamento sono visibili | Man. + Auto |
| **AC-13** | F-56, F-57 | 1) Parser: `0902` con `ATH0` (`014` / `0:` / `1:` / `2:`) e con `ATH1` (`7E8 10 14…`) → VIN `ZFA19900001234567`. 2) `41 00 BE 3E B8 11` → PID 01 03 04 05 06 07 0B 0C 0D 0E 0F 11 13 14 15 1C 20. 3) `41 01 82 07 65 04` → spia accesa, 2 codici, benzina, monitor EVAP non completo. 4) DTC: `01 33` → P0133; `C1 00` → U0100; `D0 16` → U1016; `81 23` → B0123; `41 23` → C0123; `43 03 01 33 C1 00 42 20` (CAN) → P0133, U0100, C0220; `43 00` → nessun codice. 5) PID: `41 0C 1A F8` → 1726 giri/min; `41 05 7B` → 83 °C; `41 2F 80` → 50,2%; `41 42 38 A4` → 14,5 V; `41 A6 00 01 E2 40` → 12345,6 km. 6) `NO DATA`, `UNABLE TO CONNECT`, `STOPPED`, `?`, NUL spuri e frammenti BLE da 20 byte sono gestiti. 7) *Fuzz* con dati casuali: nessuna eccezione. 8) Il simulatore esegue tutti gli 8 scenari della demo in vitest e in Expo web. 9) Un registro dei comandi inviati in MVP **non contiene mai il servizio 04** né altri comandi di scrittura | Auto |
| **AC-14** | F-58, F-59, F-60, F-61, F-62 | 1) Sulla build di sviluppo, con almeno **2 adattatori BLE e 2 auto EOBD** (benzina e diesel se disponibili), la sequenza *collegamento → report → snapshot* riesce senza intervento tecnico in almeno **9 tentativi su 10**; i risultati (tentativi, adattatori, PID realmente risposti) sono registrati come fixture. 2) Il report elenca come «letti» solo i PID che hanno realmente risposto; olio, TPMS, usura freni, stato batteria non compaiono mai tra i letti. 3) Ogni errore della tabella di 6.3.5 è riproducibile con la demo e mostra il testo previsto. 4) Su iPhone Classic non è offerto; con permesso negato c'è il percorso «Apri impostazioni». 5) Dopo una disconnessione l'app riprova al massimo 3 volte con backoff e rifà l'init completo. 6) Snapshot e codici si salvano nella timeline e nello storico DTC; eliminando la sessione si eliminano le sue letture. 7) La modalità demo completa l'intero flusso senza adattatore; le sessioni demo non si collegano mai a un'auto reale. 8) Con l'app in background la connessione si chiude e al ritorno compare il messaggio. 9) Snapshot ≤ 15 s tipico su CAN; ricerca protocollo ≤ 15 s | Disp. (1, 4, 5, 8, 9) + Auto (2, 3, 6, 7) |

**Definizione di «MVP pronto» (gate di rilascio):** tutte le AC verdi; nessun bug noto di perdita di dati o di scadenza calcolata male; SP-1..SP-8 chiusi con esito scritto; dichiarazioni degli store e informativa privacy completate; closed test Play concluso (se account personale); video con hardware reale e modalità demo pronti per App Review; `npx expo install --check` e `npx expo-doctor` puliti; `THIRD_PARTY_LICENSES` aggiornato; parere legale ottenuto o rinuncia esplicita dell'utente.

## 12. Piano di realizzazione e spike

Le durate sono **stime della ricerca per uno sviluppatore singolo assistito** [FEA Raccomandazioni] (confidenza bassa-media), non impegni: si ricalcolano dopo la Fase 0.

### 12.1 Fasi e gate

| Fase | Durata stimata | Contenuto | Gate di uscita |
|---|---|---|---|
| **0. Fondamenta** | 2-3 settimane | Scaffolding SDK 57 (9.4); struttura a strati e `dependency-cruiser`; dominio puro (`dates`, `units`, `maintenance`, `reminders`, piano notifiche) con i vettori delle ricerche; livello dati (apertura, PRAGMA, runner, `0001_init` con le modifiche M-1..M-5, seed, repository) provato con `node:sqlite`; parser OBD + `MockTransport` con trascrizioni; scheletro della UI in Expo web con dati in memoria; prima development build Android su EAS | `vitest` verde, 0 violazioni `dependency-cruiser`, snapshot dello schema committato, **SP-1, SP-2, SP-7 e SP-12 chiusi** |
| **1. Libretto e scadenze** | 6-8 settimane | Casi d'uso e UI di tutte le P0 non-OBD: garage, scheda auto, km, wizard e motore scadenze, revisione e bollo, interventi e cambio olio, rifornimenti, spese e costi, livelli, documenti, polizze, timeline, notifiche reali e «Verifica notifiche», backup/import/export/cancellazione, onboarding, «Oggi», impostazioni, accessibilità, it-IT, informative | **AC-01..AC-12 verdi**; **SP-3 eseguito**. A build stabile si apre il closed test Android (14 giorni, 12 tester) in parallelo alla Fase 2, se l'account è personale |
| **2. OBD reale** | 4-6 settimane | Spike BLE nella prima settimana (**SP-4**); `BleTransport`; wizard di collegamento; report di capacità; snapshot; live; storico DTC con descrizioni italiane; qualità adattatore; sleep; demo completa; registrazione di fixture da auto reali (**SP-8**); misura dell'assorbimento (**SP-10**); video con hardware per App Review; decisione su Classic (**SP-5**) | **AC-13 e AC-14 verdi**; lista adattatori provati |
| **3. Pubblicazione dell'MVP** | 3-4 settimane (in parte parallele alla 2) | Schede store, privacy policy, *Data safety* e *App Privacy*, TestFlight interno, App Review, closed test concluso, parere legale | «MVP pronto» (fine sezione 11) |
| **4. V1** | 3-6 mesi dal lancio | In ordine di valore/sforzo: backup automatico su cartella e cifratura (F-78, F-79) · Classic Android e Wi-Fi (F-68, F-67) · cancellazione codici protetta (F-66) · OCR libretto (F-75) · widget (F-76) · PDF rivendita (F-50) · importatori CSV (F-77, anticipabile: domanda 5) · set gomme (F-46) · patente (F-31), `.ics` (F-33), passaggio di proprietà (F-32) · Pro (F-81) · anomalia olio (F-45), trend batteria (F-70), report avanzati (F-43), registrazione sessione (F-69), azioni rapide notifiche (F-80), checklist pre-viaggio (F-51) | Ogni funzione V1 ha i propri criteri di accettazione scritti prima dell'implementazione, nello stesso formato della sezione 11 |
| **5. V2** | Solo con domanda dimostrata | Famiglia e sync E2E (F-83), prezzi MIMIT (F-84), CarPlay/Android Auto (F-85), profili per marca (F-72), OBFCM (F-73), UDS (F-74), stime derivate (F-71), protezione avanzata (F-82), avvisi ambientali (F-34) | — |

**Ordine di implementazione consigliato** [DAT §8.9]: 1) `domain/{dates,units,maintenance,reminders}` copiando il codice di riferimento e i suoi test; 2) `data/db` (apertura, PRAGMA, runner, `0001`, seed) con l'adattatore Node; 3) repository e casi d'uso `addVehicle`, `addOdometerReading`, `addServiceRecord`, `completeItem`, `reconcileReminders`; 4) `syncNotifications` con lo scheduler che stampa, poi l'adattatore reale; 5) export/import; 6) UI. Per ogni funzione si scrivono **prima i test dai vettori** e poi il codice.

### 12.2 Spike tecnici (si chiudono solo provando)

| ID | Domanda | Come si prova | Criterio di riuscita | Piano B | Fase |
|---|---|---|---|---|---|
| **SP-1** | `expo-sqlite` 57 supporta `STRICT` e `VACUUM INTO`? Quale versione di SQLite? | `select sqlite_version()` su telefono (≥ 3.37); copia pre-migrazione con `VACUUM INTO` e percorso del file; `withExclusiveTransactionAsync`; WAL | Tutte le prove passano su Android e iOS | Togliere `STRICT` (il resto non cambia); copia con file system | 0 |
| **SP-2** | Hermes si comporta come Node su `new Date(y,m,d,h,mm)` nei salti dell'ora legale, su `Intl` e sulla casualità per gli ULID? | Eseguire i vettori di data/ora e di formattazione su telefono | 25-10-2026 09:00 → 08:00Z; 28-3-2027 09:00 → 07:00Z; ora inesistente spostata in avanti; `crypto.getRandomValues` disponibile | Conversione isolata in `platform`; ULID con `expo-crypto` | 0-1 |
| **SP-3** | Le notifiche arrivano davvero? | Le 10 prove di [DAT §4.11]: permessi, app chiusa, riavvio, cambio fuso, notti del cambio ora, oltre 64 candidate, risparmio energetico Xiaomi/Samsung, arresto forzato, aggiornamento, data di sistema cambiata; più `identifier` ripetuto e `channelId` su Android | Consegna entro 15 minuti nelle condizioni normali; comportamento documentato nelle altre | Più peso a banner in app, sentinella, `.ics` | 1 |
| **SP-4** | Quale libreria BLE funziona su RN 0.86 con ELM327 BLE? | Dev build con `react-native-ble-manager` 12.5.3 su Android 12+ e Android 8-11 e su iPhone in **build di release**: scansione, `retrieveServices`, notifica, `writeWithoutResponse` (`ATZ`, `ATE0`, `0100`), lettura continua 10 minuti, spegnimento adattatore, riconnessione; ripetere con `react-native-ble-plx` 3.5.1 (+ patch iOS) | Connessione e 10 minuti di lettura senza crash né blocchi con almeno 2 adattatori; sceglie la libreria più **stabile**, non la più popolare | Fork `@sfourdrinier/react-native-ble-plx` 3.9.3; Expo Module nativo | 2 (settimana 1) |
| **SP-5** | `react-native-bluetooth-classic` (rc) funziona su Android con RN 0.86? | Adattatore Classic accoppiato dalle impostazioni; SPP `00001101-0000-1000-8000-00805F9B34FB`; fallback socket sicuro → non sicuro; plugin locale per i permessi | Connessione e `0100` riusciti | Modulo Kotlin proprio (Expo Module) | 2 o V1 |
| **SP-6** | `react-native-tcp-socket` 6.4.3 gira tramite interop? | Connessione TCP a un emulatore ELM327 su PC nella stessa rete (porta 35000); prompt «Rete locale» su iPhone | Lettura e scrittura riuscite | Modulo proprio | V1 |
| **SP-7** | La build rispetta i vincoli degli store? | Primo build EAS: `targetSdkVersion` effettivo (`aapt dump badging`), elenco dei permessi, rimozione di `INTERNET`, `allowBackup`, immagine con Xcode 26+, `npx expo-doctor`; disponibilità di Expo Go per SDK 57 sul telefono Android | `targetSdk` ≥ 36; permessi attesi; 0 avvisi bloccanti | `expo-build-properties` | 0 |
| **SP-8** | Cosa rispondono davvero le auto? | Con le auto di prova: matrice dei PID (`012F`, `0142`, `01A6`, `015C`, `0131`, `0151`, `011C`, Mode 09 `0917`); ordine dei bit di `0101` byte B; per Mode 04 (solo su un'auto propria, motore spento) la risposta negativa e lo stato dei monitor prima e dopo; comportamento dei cloni (`ATAMC`, `ATCRA`); ISO-TP con più ECU | Fixture registrate; tabella «PID realmente rispondenti» per auto; correzione di 5.1 e del parser dove serve | — | 2 |
| **SP-9** | Gli intervalli del catalogo sono ragionevoli? | Confronto con i libretti di uso e manutenzione di 3-5 auto italiane diffuse (es. una Panda, una 500, una Golf, una Clio, una Yaris) | Scostamenti documentati e catalogo corretto | Valori più cauti e note | 1 |
| **SP-10** | Quanta corrente assorbono gli adattatori a quadro spento? | Multimetro in serie, per ogni adattatore di prova | Valori documentati nella scheda adattatore | Avvisi più forti | 2 |
| **SP-11** | Quanto è affidabile l'OCR del libretto? (V1) | Corpus di libretti (anche vecchi formati) con ML Kit contro API native | Tasso di campi corretti misurato | Inserimento manuale assistito | V1 |
| **SP-12** | L'anteprima web può usare `sql.js`? E `node:sqlite` regge in CI? | Adattatore `sql.js` in Expo web su Windows; `vitest` con `node:sqlite` su Node 24.19 | La UI su PC apre e salva dati; i test del DB passano | Repository in memoria sul web | 0 |

### 12.3 Cosa serve per procedere (hardware e account)

| Serve | Per | Quando |
|---|---|---|
| 1-2 adattatori BLE (uno economico noto e, se possibile, un OBDLink CX, Vgate iCar Pro 2S o vLinker MC+) e, se già posseduto, un clone Classic | SP-4, SP-5, SP-8, SP-10 | Fase 0 (acquisto) / Fase 2 |
| Almeno 1 auto EOBD (benzina) e, se possibile, 1 diesel e 1 auto GPL/metano; meglio con dati di tagliandi reali per i test | SP-8, SP-9, dati demo | Fase 2 |
| 1 telefono Android 12+ (e se possibile uno con Android 8-11) e 1 iPhone | SP-1..SP-4 | Fase 0 |
| Account Expo (gratuito) | EAS, build | Fase 0 |
| Account Google Play (25 USD) | Closed test, pubblicazione | Fine Fase 1 |
| Account Apple Developer (99 USD/anno) | Build su iPhone, TestFlight, App Store | Quando si vuole provare su iPhone |
| Parere di un legale su GDPR e dichiarazioni degli store | Fase 3 | Domanda 2 |

*Contingenza:* se l'utente possiede solo un iPhone, SP-4 e SP-8 partono con un adattatore BLE su iOS (serve comunque l'account Apple); se possiede solo Android, l'MVP si prova per intero su Android e iOS si valida prima del rilascio con TestFlight.

## 13. Modello economico e policy

Il modello è una **proposta da confermare** (domanda 4). L'MVP non include acquisti in app: la libreria di acquisto non è stata ricercata ([DA VERIFICARE]).

### 13.1 Proposta

| Livello | Cosa include | Prezzo |
|---|---|---|
| **Gratis per sempre** | Tutto il registro dati (auto illimitate, interventi, scadenze, rifornimenti, spese, documenti, livelli, polizze), backup ed esportazione, importazione, lettura OBD di base (collegamento, VIN, codici, dati live essenziali), notifiche | 0 |
| **Pro** (V1) | OCR del libretto e delle ricevute, widget e scorciatoie, PDF «storico per rivendita» con QR di verifica, registrazione OBD avanzata con grafici ed esportazione, temi e icone, condivisione familiare via file | **Acquisto una tantum 14,99-19,99 EUR** (con Family Sharing dove possibile) |
| Sincronizzazione cifrata (V2, solo con costo reale di server) | Sync E2E opzionale; l'app resta pienamente funzionante senza | 1,99 EUR/mese o 14,99 EUR/anno |
| Sostegno | Mancia una tantum | 2-5 EUR |
| Affiliazione dichiarata | Link opzionale a 2-3 adattatori BLE **provati** (riduce resi e supporto) | Commissione dichiarata in app |

**Benchmark (EUR, salvo diversa indicazione) [FEA §25]:** Torque Pro 3,55 una tantum (Android) · Car Scanner 8,99 lifetime o 5,49/anno · OBD Fusion 9,99 (iOS) / 6,49 (Android) più add-on per marca da circa 15 USD · Simply Auto Gold 9,99 USD una tantum · My Car 11,99/anno · Fuelio Pro iOS 14,99/anno · Drivvo Pro 24,90/anno *secondo gli utenti* · Carly 73,99 «All Brands» più adattatore circa 70 · FIXD 99,99 USD/anno. Il prezzo del Pro è quindi sopra il «lifetime» di Car Scanner e vicino ai canoni annuali: **va validato** con la landing page e la beta (13.4).

### 13.2 Regole etiche (policy pubblica)

1. Mai bloccare lettura, esportazione o backup dei dati dell'utente.
2. Mai pubblicità, mai vendita o condivisione di dati o posizione.
3. Prezzo bloccato per chi ha già acquistato; **nessuna licenza revocata** (lezione aCar).
4. Niente abbonamenti settimanali, prove con addebito a sorpresa, rinnovi non notificati (eventuale rinnovo: promemoria 7 giorni prima).
5. Rimborso semplice entro 14 giorni; trasparenza su cosa è Pro **prima** dell'acquisto.
6. Nessuna lead generation assicurativa come ricavo primario (conflitto di interessi).
7. Promessa pubblica: «se smettiamo di aggiornare MyGarage, l'esportazione dei tuoi dati resta».

### 13.3 Costi

Costi vivi minimi: Google Play 25 USD una tantum, Apple Developer 99 USD/anno, EAS gratuito (15+15 build/mese). Nessun server. Il rischio economico principale è il **tempo di manutenzione** (aggiornamenti SDK ogni circa 4 mesi, nuovi OS, supporto), non i costi vivi [FEA Rischi].

### 13.4 Posizionamento e validazione

- Messaggio di lancio: *«Il libretto digitale della tua auto: i tuoi dati restano tuoi.»* Utenti target iniziali: chi cerca alternative a app con paywall su sincronizzazione ed esportazione.
- **Mai citare Drivvo o altri concorrenti** nel marketing senza fonte ufficiale.
- Validazione prima di investire in V1: 10-15 interviste ad automobilisti italiani (con almeno 2 auto GPL/metano e 2 elettriche/ibride); landing page con lista d'attesa per «storico per rivendita» e «condivisione familiare»; beta con 20-30 utenti che portano i propri adattatori, per misurare il tasso di successo del collegamento e raccogliere i PID realmente supportati tramite un **file di report che l'utente sceglie di condividere** (nessun invio automatico, nessun dato personale: niente targa né VIN).
- Piano di manutenzione dichiarato: aggiornamento a ogni SDK Expo, prove sulle ultime versioni di iOS e Android, pagina «Stato del progetto».

## 14. Rischi e mitigazioni

Probabilità (P) e impatto (I): A = alta, M = media, B = bassa. Giudizio dell'architetto sulla base delle ricerche.

| ID | Rischio | P | I | Mitigazione | Riferimenti |
|---|---|---|---|---|---|
| R-01 | **Over-promise OBD**: «scarica tutto» non è mantenibile con i PID standard; si riproduce il «pago e non è supportata» (Car Scanner, OBD Fusion, Carly) | A | A | Contratto di onestà (sezione 5), report di capacità prima di tutto, checklist «letti/non disponibili», regole di comunicazione, demo, AC-14 | 5.1, 5.4, F-59 |
| R-02 | **Connessione OBD instabile e adattatori clone** (19-34% delle recensioni negative delle app OBD) | A | A | Wizard guidato, banner di qualità, elenco consigliato **dopo le prove**, messaggi in italiano, nessun ritentativo infinito, diagnostica integrata | F-58, F-64, SP-4, SP-8 |
| R-03 | **iPhone senza Bluetooth Classic**: molti adattatori già posseduti non funzionano | A | M | Domanda «che adattatore hai?» prima di installare/collegare, avviso esplicito, lista BLE, Wi-Fi in V1 | 5.3, 6.3.5 |
| R-04 | **Librerie native e New Architecture** (ble-manager non provato su RN 0.86; ble-plx legacy con issue aperte; Classic solo rc; tcp-socket legacy) | M | A | Interfaccia `ObdTransport`; spike prima di scrivere il resto; una sola libreria BLE; piano B con Expo Module; Classic e Wi-Fi isolati | 9.2, SP-4, SP-5, SP-6 |
| R-05 | **Notifiche non consegnate** (risparmio energetico dei produttori, arresto forzato, tetto iOS di 64, permesso negato) | M | A | Finestra 60 + sentinella, ripianificazione continua, «Oggi» come fonte primaria, «Verifica notifiche», `.ics`, prove su dispositivi reali | 8.4, NFR-04, SP-3 |
| R-06 | **Errore normativo** (revisione, bollo, RC, gomme, bombole) che causa una multa all'utente | M | A | Regole come dati con fonte e data, override manuale, avvertenze, nessun importo, rilettura ogni 6 mesi, controlli al 16-11-2026 (D.L. 162/2026) e dopo l'1-12-2026 (importi), tolleranza RC solo informativa | Sezione 7 |
| R-07 | **Perdita del telefono = perdita dei dati** (lezione My Car, Simply Auto, aCar) | M | A | Backup nell'MVP, banner, guida al cambio telefono, V1 backup su cartella cloud, `allowBackup = false` spiegato | F-06, F-78 |
| R-08 | **Migrazioni o import che corrompono i dati** | B | A | Runner transazionale con rollback, copia `VACUUM INTO`, `foreign_key_check`, fixture per ogni versione, snapshot dello schema | 8.6, NFR-03 |
| R-09 | **Privacy e dichiarazioni degli store sbagliate**; GDPR valutato solo su fonti secondarie; possibile applicazione dell'accessibilità obbligatoria se l'editore è un'azienda non microimpresa | M | M | Nessun SDK di terzi, `redact()`, informativa semplice, parere legale prima del rilascio, accessibilità AA | 8.5, NFR-02, NFR-07, domanda 2 |
| R-10 | **Complessità per uno sviluppatore singolo** (28 tabelle, 85 funzioni) | M | M | Fasi con gate; UI minima per le aree secondarie; `0001` riscrivibile fino al rilascio; le P1 dell'MVP si spostano in V1 se la Fase 1 supera le stime; ordine di implementazione dalla logica verso la UI | Sezione 12 |
| R-11 | **Vincoli degli store**: closed test Play per account personali (12 tester × 14 giorni), App Review con hardware, Xcode 26, `targetSdk` 36, verifica sviluppatore Android dal 2027 | M | M | Calendario con closed test a fine Fase 1; demo + video; account Play già registrato; TestFlight interno | 9.6, NFR-13 |
| R-12 | **Evoluzione tecnica e normativa dell'OBD** (OBDonUDS, Reg. UE 2026/699 con autenticazione degli strumenti, Euro 7): gli ELM327 generici potrebbero non funzionare su auto recenti | M | M | Strato `DiagnosticService` astratto; messaggio «questa auto non risponde» senza colpevolizzare; monitoraggio annuale delle norme | 5.6 |
| R-13 | **Contaminazione di licenze** (GPL, CC BY-NC-SA) e database PID proprietari | B | A | Codice solo da MIT/Apache/MPL con attribuzione; python-OBD, ELM327-emulator, app emulatore Android solo come strumenti esterni; `THIRD_PARTY_LICENSES`; nessuna tabella Wikipedia copiata | 8.7, NFR-11 |
| R-14 | **Differenze di Hermes e di SQLite su telefono** (`Date`, `Intl`, `STRICT`, `VACUUM INTO`) | M | M | Date di calendario, formattazione manuale, conversione locale isolata in `platform`, SP-1 e SP-2 | 8.1 |
| R-15 | **Responsabilità legata alla cancellazione dei codici** e alla revisione | B | A | Rimandata a V1; modalità avanzata, salvataggio prima, doppia conferma, nessun marketing «per la revisione» | 5.5, F-66 |
| R-16 | **Reazione dei concorrenti e finestra breve** (Drivvo può ripristinare funzioni; UnipolMove è gratuita; l'app IO ricorda il bollo) | M | M | Differenziare su OBD + libretto + dati locali; importatori in V1 (anticipabili); nessuna affermazione non verificata | 13.4, domanda 5 |
| R-17 | **Abbandono del progetto** (prima lamentela di Simply Auto, aCar, Torque) | M | A | Manutenzione dichiarata, esportazione permanente, pagina di stato, architettura testabile, aggiornamento SDK ogni ~4 mesi | NFR-12, NFR-14 |
| R-18 | **Batteria dell'auto scaricata dall'adattatore sempre inserito** | M | M | Sessioni a richiesta, sleep, avvisi di tensione, nota «se l'auto resta ferma più di 2 settimane scollega», misura con SP-10 | F-65 |
| R-19 | **Intervalli del catalogo sbagliati per un'auto specifica** | A | M | «Indicativo», wizard sull'ultimo intervento, valori modificabili, libretto prevale, SP-9 | 7.1 |
| R-20 | **Previsione dei km imprecisa** (l'utente non aggiorna l'odometro) | A | M | Stima etichettata, previsione che avanza col tempo, invito a aggiornare i km, letture gratuite da rifornimenti e OBD | F-26 |
| R-21 | **ZIP in memoria con molte foto** (memoria insufficiente) | M | M | Foto ridimensionate in ingresso, soglia e avviso, compressore nativo se serve | 8.5 |
| R-22 | **Dipendenza da EAS** (coda a bassa priorità, 15 build/mese) | M | B | Fast Refresh e dev client (ricompilare solo se cambiano pacchetti nativi o plugin); Starter 19 USD/mese solo se serve | 8.8 |
| R-23 | **Sostenibilità economica** (nessuna pubblicità, acquisto una tantum) | M | M | Costi vivi minimi, Pro una tantum, nessun server, roadmap ristretta | Sezione 13 |
| R-24 | **Marchio e nome** non verificati su Google Play, UIBM, EUIPO | M | M | Verifica prima di fissare l'identificatore e la grafica; alternative pronte («Tagliando» come parola chiave) | 1.3, domanda 1 |
| R-25 | **Descrizioni dei codici DTC**: licenze e qualità | B | M | Descrizioni scritte in proprio per i codici più comuni; `dtc-lookup` (MIT, **licenza e proprietario da riverificare**) solo come riferimento | F-62 |

## 15. Verifiche ancora aperte

### 15.1 Decisioni che spettano all'utente

Sono le uniche decisioni che non si possono prendere né verificare dall'esterno. Nessuna blocca la Fase 0, tranne la 3 per i tempi dello spike.

| N. | Decisione | Contesto e opzioni | Raccomandazione | Serve entro |
|---|---|---|---|---|
| **1** | **Nome definitivo e verifica del marchio** | «MyGarage» non risulta occupato sull'App Store italiano (ricerca del 2026-10-07), ma non sono controllati Google Play, UIBM, EUIPO, dominio e profili social. L'identificatore dell'app è permanente dopo la pubblicazione. Alternative: «Tagliando» (descrittivo, forte per la ricerca nello store, marchio debole), «Garagino» | Confermare «MyGarage» dopo una verifica su UIBM/EUIPO e Play Console; tenere «Tagliando» come parola chiave del sottotitolo | Prima della prima build di produzione (fine Fase 1) |
| **2** | **Chi pubblica sugli store (persona o azienda) e se spendere per un parere legale** | Account personale: costo 25 USD (Play) e 99 USD/anno (Apple) con nome legale dell'utente come venditore; Play richiede il closed test (12 tester × 14 giorni). Account organizzazione: serve D-U-N-S e sito web; il titolare dei dati e gli obblighi di accessibilità (European Accessibility Act, che esenta solo le microimprese) dipendono da chi pubblica. Il parere di un legale su GDPR, dichiarazioni degli store e uso del VIN è raccomandato dalle ricerche | Decidere prima di creare gli account; chiedere il parere prima della Fase 3 | Fine Fase 1 |
| **3** | **Hardware e dispositivi disponibili** | Quali adattatori ELM327 possiedi (Classic o BLE, marca) e quali auto di prova (benzina/diesel/GPL, anno)? Hai un Android 12+ e/o un iPhone? Se l'adattatore è Classic e il telefono Android, il Bluetooth Classic sale in MVP (F-68); se hai solo un iPhone servono un adattatore BLE e l'account Apple prima di SP-4 | Acquistare 1-2 adattatori BLE; condividere modelli e anno delle auto | Inizio Fase 0 (per pianificare SP-4) |
| **4** | **Modello economico** | (a) Gratis con Pro una tantum 14,99-19,99 EUR in V1 (proposta); (b) tutto gratuito; (c) abbonamento (sconsigliato: è la prima lamentela dei concorrenti). Il prezzo non è validato | (a), con prezzo da validare in beta | Prima della V1 |
| **5** | **Importatori CSV dei concorrenti nell'MVP?** | L'ondata di recensioni negative di Drivvo (ott 2026) è una finestra breve e non confermata ufficialmente. Anticipare F-77 all'MVP costa circa 1-2 settimane e richiede file di esempio reali esportati dalle app | Tenerlo in V1 salvo che l'utente voglia cavalcare la finestra; in quel caso fornire i file di esempio | Inizio Fase 1 |

### 15.2 Punti da verificare (non sono decisioni)

| ID | Punto | Perché è aperto | Si chiude con |
|---|---|---|---|
| V-01 | Funzionamento delle librerie BLE, Classic e TCP su RN 0.86 | Nessuna prova di esecuzione né del ricercatore né della verifica | SP-4, SP-5, SP-6 |
| V-02 | UUID GATT di Vgate iCar (iOS) e ISSC/Microchip; layout OBFCM `0917`; sentinel di `01A6`; NRC `7F 04 22`; reset dei monitor dopo Mode 04; ordine dei bit di `0101` byte B | Ipotesi senza fonte indipendente | SP-8 |
| V-03 | MTU iOS (135/158/185) e MTU 517 automatico su Android 14 | Non riscontrati nelle fonti | SP-4 (si legge l'MTU effettivo: non si assume) |
| V-04 | `NSLocalNetworkUsageDescription` per il Wi-Fi iOS | Nessuna fonte Apple primaria letta | SP-6 |
| V-05 | OBDonUDS obbligatorio in UE; impatto del Reg. 2026/699 sul Mode 01/03 generico | Le fonti non lo dicono | Monitoraggio normativo |
| V-06 | Versione di SQLite in `expo-sqlite`; `Date`/`Intl` su Hermes; sostituzione di notifiche con stesso `identifier` su Android; tetto reale di allarmi; comportamento dopo l'aggiornamento dell'app | Non provati | SP-1, SP-2, SP-3 |
| V-07 | Expo Go per SDK 57 su Google Play; immagine EAS con Xcode 26+; `targetSdk` effettivo; sideload e `adb` rispetto alla verifica sviluppatore Android | Non confermati | SP-7 |
| V-08 | Licenza di `react-native-ble-plx` (npm: MIT; file nel repository: Apache-2.0), di `poropi/elm327emu` e di `dtc-lookup` (proprietario scritto in due modi) | Incoerenze tra le fonti | Lettura dei file di licenza prima di qualsiasi riuso |
| V-09 | Revisione molto anticipata o tardiva, auto importate, veicoli storici | Nessuna fonte primaria | Circolari MIT / Motorizzazione; nel frattempo override e avviso |
| V-10 | **Conversione in legge del D.L. 162/2026** (entro il 2026-11-16) e testo di D.Lgs. 147/2026; eventuale rateizzazione del bollo dal 2028 | Decreto in conversione; fonti secondarie discordanti | Rilettura dopo il 2026-11-16 |
| V-11 | Importi delle sanzioni dal 1-1-2027 (adeguamento ISTAT, art. 195 c.3) | Dipende da una proroga della sospensione | Rilettura dopo il 2026-12-01 |
| V-12 | Battistrada minimo 1,6 mm (art. 237 Reg. CdS); soglie 3 e 4 mm; limite di età dei pneumatici | Testo non riletto | Fonte primaria prima di F-46 |
| V-13 | Bombole: serbatoio GPL (data di riferimento), CNG tipo IV (2 o 4 anni) | Fonti in conflitto | Testo del DM 13-5-2022 e consultazione di un installatore |
| V-14 | Patente: soglie nel giorno del compleanno (50/70), rinnovo degli ultraottantenni, clamp del 29 febbraio | Testo e fonti MIT non coincidono | Prima di F-31 (V1) |
| V-15 | Prescrizione e ravvedimento del bollo; slittamento dei festivi | Fonti secondarie | Non implementati nell'MVP |
| V-16 | Contachilometri sostituito o azzerato: serve un «epoch» per veicolo? Rimborsi e storni di spesa: importi negativi o tipo «rimborso»? Ora della notifica per singola regola? Telemetria nel backup? | Domande di prodotto della ricerca dati | Prima della V1 sulla base dell'uso |
| V-17 | Valore di ultima istanza di 12.000 km/anno | Nessuna fonte documentata | Chiedere sempre «quanti km fai all'anno?» o documentare una fonte (ACI/ISTAT) |
| V-18 | Domanda di mercato per «storico per rivendita» e «condivisione familiare»; qualità reale dell'OCR; adattatori consigliati | Nessun dato quantitativo | Interviste, landing page, beta, SP-11 |
| V-19 | Libreria per gli acquisti in app (iOS e Android) | Non ricercata | Ricerca dedicata prima della V1 |
| V-20 | L'app iOS «Torque Pro» di Collabrains: non è verificato se sia non ufficiale | Accuse di utenti, non verificate | Non usare il nome «Torque» e non fare affermazioni |

## Appendici

### Appendice A — Glossario italiano (terminologia dell'interfaccia)

| Termine | Significato nell'app |
|---|---|
| Tagliando | Manutenzione programmata periodica |
| Revisione | Controllo periodico obbligatorio del veicolo (art. 80 CdS) |
| Bollo auto | Tassa automobilistica regionale |
| RC auto / RCA | Assicurazione obbligatoria di responsabilità civile |
| Kasko, furto e incendio, assistenza stradale | Garanzie accessorie della polizza |
| Classe di merito | Classe bonus-malus dell'RC auto (1-18) |
| Scatola nera | Dispositivo telematico della polizza |
| Carta di circolazione / Documento Unico (DU) | Libretto del veicolo |
| Targa, telaio (VIN) | Identificativi del veicolo |
| Pieno, self, servito | Rifornimenti |
| GPL, metano, gasolio, HVO, AdBlue | Carburanti e fluidi |
| Gomme invernali, estive, 4 stagioni; deposito gomme | Pneumatici |
| Spia motore (MIL) | Spia di malfunzionamento delle emissioni |
| Codice guasto (DTC) | Codice diagnostico memorizzato dalla centralina |
| Centralina (ECU) | Unità elettronica di controllo |
| Monitor di prontezza | Test di autodiagnosi dei sistemi di emissione |
| Dati al momento del guasto (freeze frame) | Fotografia dei valori quando è stato registrato un codice |
| Adattatore OBD / ELM327 | Dispositivo da inserire nella presa diagnostica |
| Quadro acceso | Chiave su ON senza avviare il motore |
| Letto dall'auto / Stimato / Inserito da te | Provenienza dei dati (5.2) |

### Appendice B — Fonti principali

Le ricerche contengono le fonti complete di ogni punto. Qui l'elenco delle fonti primarie o ufficiali su cui poggiano le decisioni.

**Mercato e funzionalità** [FEA]
- https://itunes.apple.com/lookup?id=1206041425&country=it · https://play.google.com/store/apps/details?id=br.com.ctncardoso.ctncar&hl=it · https://drivvo.com/en/personal-use/ (Drivvo)
- https://apps.apple.com/it/app/fuelio-prezzi-benzina-costi/id1487753318 · https://www.simplyauto.app · https://apps.apple.com/it/app/my-car-gestione-auto/id1165749302
- https://apps.apple.com/it/app/car-scanner-elm-obd2/id1259933623 · https://www.carscanner.info/?p=69 · https://www.carscanner.info/choosing-obdii-adapter/
- https://apps.apple.com/it/app/obd-fusion/id650684932 · https://apps.apple.com/it/app/carly-obd2-auto-scanner/id467344155 · https://apps.apple.com/us/app/fixd-obd2-scanner/id957168651
- https://apps.apple.com/it/app/unipolmove/id1609074315 · https://it.motor1.com/features/496364/app-io-pagare-bollo-auto-aci-certificati/
- https://www.mimit.gov.it/it/open-data/elenco-dataset/carburanti-prezzi-praticati-e-anagrafica-degli-impianti

**OBD** [OBD]
- https://www.elmelectronics.com/wp-content/uploads/2016/07/ELM327DS.pdf (datasheet ELM327, letto in locale dalla verifica)
- https://en.wikipedia.org/wiki/OBD-II_PIDs · https://www.csselectronics.com/pages/obd2-pid-table-on-board-diagnostics-j1979
- https://support.obdlink.com/support/solutions/articles/43000746707-obdlink-cx-adapter-notes · https://www.obdautodoctor.com/help/articles/supported-obd-adapters/
- https://developer.android.com/develop/connectivity/bluetooth/bt-permissions · https://developer.android.com/develop/background-work/services/fgs/service-types · https://developer.android.com/google/play/requirements/target-sdk
- https://developer.apple.com/documentation/bundleresources/information-property-list/nsbluetoothalwaysusagedescription
- https://revisione.dekra.it/sites/default/files/Il%20nuovo%20controllo%20Scantool%20OBD.pdf · https://www.noerr.com/en/insights/delegated-regulation-eu-2026-699-sets-out-new-guidelines-for-secure-gateways-obd-access-and-rmi · https://oeil.europarl.europa.eu/oeil/en/document-summary?id=1784743
- https://github.com/Anush-aj/obfcm · https://github.com/Ircama/ELM327-emulator (solo strumento esterno, CC BY-NC-SA 4.0)

**Stack e store** [STK]
- https://expo.dev/changelog/sdk-57 · https://expo.dev/changelog · https://expo.dev/changelog/expo-go-57-login · https://expo.dev/pricing
- https://docs.expo.dev/versions/latest/sdk/notifications/ · https://docs.expo.dev/develop/development-builds/introduction/ · https://docs.expo.dev/more/create-expo/
- https://reactnative.dev/blog/2025/10/08/react-native-0.82
- https://www.npmjs.com/package/react-native-ble-manager · https://github.com/innoveit/react-native-ble-manager · https://github.com/dotintent/react-native-ble-plx/issues/1278 · https://github.com/kenjdavidson/react-native-bluetooth-classic
- https://support.google.com/googleplay/android-developer/answer/11926878 · https://support.google.com/googleplay/android-developer/answer/14151465 · https://support.google.com/googleplay/android-developer/answer/6112435 · https://developer.android.com/developer-verification
- https://developer.apple.com/programs/enroll/ · https://developer.apple.com/news/upcoming-requirements/ · https://developer.apple.com/app-store/review/guidelines/ · https://developer.apple.com/forums/thread/811171
- https://pub.dev/packages/flutter_blue_plus/license

**Norme italiane** [REG]
- https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:1992-04-30;285 · https://aci.gov.it/codice-della-strada/art-80/ · https://aci.gov.it/codice-della-strada/art-94/ · https://aci.gov.it/codice-della-strada/art-126/ · https://aci.gov.it/codice-della-strada/art-193/
- https://www.mit.gov.it/node/2789 · https://www.ilportaledellautomobilista.it/web/portale-automobilista/veicoli/revisioni · https://www.mit.gov.it/rinnovo-patente · https://www.ilportaledellautomobilista.it/web/portale-automobilista/-/mit-la-patente-scade-al-compleanno
- https://www.lautomobile.aci.it/attualita/bollo-auto-2026-scadenze-tariffe-ed-esenzioni-la-guida-completa/ · https://www.lautomobile.aci.it/attualita/bollo-auto-tutte-le-novita-dal-2026-al-2028/ · https://www.lautomobile.aci.it/attualita/addio-al-bollo-auto/ · https://online.aci.it/acinet/calcolobollo/index.asp
- https://www.ivass.it/consumatori/quesiti/r.c.auto/index.html · https://www.lautomobile.aci.it/attualita/gomme-invernali-2026-dal-15-ottobre-si-possono-montare-obbligo-date-e-multe/ · https://www.poliziadistato.it/articolo/dal-15-novembre-scatta-l-obbligo-degli-pneumatici-invernali
- https://www.federmetano.it/revisione-bombole-metano/ · https://aci.gov.it/pratica-auto/passaggio-di-proprieta-mancata-trascrizione-al-pra/
- https://competition-policy.ec.europa.eu/system/files/2021-09/FAQ_application_of_EU_antitrust_rules_in_the_motor_vehicle_sector_en.pdf · https://ildiritto.it/amministrativo/sanzioni-stradali-stop-aggiornamento-biennale/

**Dati e piattaforma** [DAT]
- https://docs.expo.dev/versions/latest/sdk/sqlite/ · https://docs.expo.dev/versions/latest/sdk/securestore/ · https://docs.expo.dev/versions/latest/sdk/background-task/
- https://www.sicurauto.it/guide-utili/assicurazioni/tacito-rinnovo-e-tolleranza-di-15-giorni-dopo-la-scadenza/

**Verifiche locali del 2026-10-07 per questa specifica:** registro npm (`npm view` sui pacchetti della sezione 9 e su `expo-template-default@sdk-57`) e ricerca iTunes IT per la collisione dei nomi (`https://itunes.apple.com/search?term=<nome>&country=it&entity=software`).

### Appendice C — Impostazioni predefinite (`app_settings`, valori JSON, nessun segreto)

| Chiave | Predefinito | Note |
|---|---|---|
| `device.id` | ULID generato al primo avvio | Per una futura sync; non esce dal dispositivo |
| `units.distance` | `"km"` | Predefinito per le nuove auto |
| `notify.enabled` / `notify.time` | `true` / `"09:00"` | Le 09:00 evitano la finestra dell'ora legale (02:00-03:00) |
| `notify.privacy` | `"generic"` | Non mostra la targa sul blocco schermo |
| `notify.maxScheduled` | `60` | Sotto il tetto iOS di 64 |
| `forecast.windowDays` / `forecast.halfLifeDays` | `180` / `90` | Parametri della media km/giorno |
| `forecast.defaultAnnualKm` | `12000` | Valore di ultima istanza a bassa confidenza, sempre etichettato «stima iniziale» |
| `telemetry.rawRetentionDays` / `telemetry.maxMb` | `30` / `50` | Retention dei campioni grezzi |
| `trash.retentionDays` | `30` | Cestino |
| `lock.enabled` / `lock.timeoutSeconds` | `false` / `60` | Blocco app |
| `backup.lastExportAt` / `backup.nudgeDays` | `null` / `30` | Promemoria di backup |
| `onboarding.done` | `false` | |
