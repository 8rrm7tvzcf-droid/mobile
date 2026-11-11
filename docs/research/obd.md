# Ricerca: OBD-II / ELM327 via Bluetooth

> Stato: ricerca di un agente, VERIFICATA da uno scettico indipendente il 2026-10-07 (25 chiamate web + datasheet ELM327 letto in locale). Le righe marcate [CORRETTO dalla verifica], [SMENTITO] o [DA VERIFICARE] indicano gli interventi dello scettico; il riepilogo e' nella sezione "Esito verifica" in fondo.

## Sintesi

Sintesi operativa (ricerca al 2026-10-06). (1) Baseline di trasporto cross-platform = BLE (iOS supporta solo BLE, WiFi e i pochi adattatori Classic MFi: OBDLink MX+, vLinker FS/MS); Android aggiunge Bluetooth Classic SPP (UUID 00001101-0000-1000-8000-00805F9B34FB), che resta il piu' veloce. Non esiste un UUID GATT unico: bisogna scegliere servizio e caratteristiche in base alle proprieta' (notify/write) e provare una lista nota (FFF0 con FFF1 notify e FFF2 write su OBDLink CX; 18F0/2AF0/2AF1 su Vgate iCar Pro BLE; FFE0/FFE1 stile HM-10; E7810A71.../BEF8D6C9... su Vgate iCar; Nordic UART). (2) Il protocollo ELM327 e' semplice ma ricco di trappole: un solo comando in volo, terminatore '>', echo, 'SEARCHING...', 'NO DATA', 'STOPPED', risposte multi-linea ISO-TP; consiglio ATH1 + parser ISO-TP proprio (con ATH0 le risposte di piu' ECU si mescolano). I cloni 'v1.5/v2.1' sono in realta' firmware v1.4 copiato: niente funzioni v2.x (ATAMC, ATCRA con 'X', gestione 7F xx 78). (3) Con OBD-II standard si leggono bene: VIN (0902), DTC (03/07/0A), MIL/readiness (0101), temperatura refrigerante, giri, velocita', tensione modulo (0142), spesso livello carburante (012F, ma alcune auto europee richiedono Mode 22); NON si leggono: livello olio, vita olio, intervallo service, pressione gomme, usura pastiglie, stato 12V, EV SoC/SoH (serve UDS/Mode 22 per marca), e l'odometro 01A6 e' opzionale e molte auto non rispondono. Non promettere queste funzioni: offrire inserimento manuale + stime derivate (km da sessioni, tagliandi per km/tempo/ore motore, soglie temperatura, trend tensione ATRV). (4) Mode 04 cancella DTC, freeze frame, dati test e resetta i monitor: richiede avviso e doppia conferma; in Italia, con DD 11-08-2023 e circolare MIT 33287 del 07-11-2023 (centri attrezzati dal 24-02-2024) [CORRETTO dalla verifica: 24-02-2024 = data di dotazione dello strumento per i centri, vedi finding 16], la revisione (veicoli M1/M2/N1 Euro 5/6 immatricolati dal 2009-09-01) legge la spia MIL e i codici via scantool, quindi cancellare i codici non risolve il guasto. (5) Permessi: Android 12+ BLUETOOTH_SCAN (con neverForLocation) e BLUETOOTH_CONNECT; <=11 serve la posizione; iOS NSBluetoothAlwaysUsageDescription, background solo se serve; per WiFi su iOS NSLocalNetworkUsageDescription; App Review richiede video/demo con hardware (il simulatore in-app serve anche a questo). (6) Stack: Expo SDK 57 (RN 0.86, solo New Architecture, serve dev build via EAS). Attenzione alla scelta della libreria BLE: react-native-ble-manager 12.5.3 (Apache-2.0, solo New Arch, attiva, ultima release 2026-09-21) e' la candidata piu' sicura; react-native-ble-plx 3.5.1 (ultima release 2026-02-18) ha issue aperte sulla New Architecture e un rewrite v4 solo in draft. Fare uno spike su dispositivo reale prima di fissare la scelta; tenere comunque l'interfaccia Transport sostituibile. (7) Test: parser puri su trascrizioni registrate + simulatore ELM327 in TypeScript dentro l'app (MockTransport); ELM327-emulator Python e' CC BY-NC-SA 4.0 (non commerciale) e python-OBD e' GPL-2.0: usarli solo come riferimento/strumento di sviluppo, non incorporarli. (8) Rischi di mercato: OBDonUDS (SAE J1979-2) obbligatorio dal MY2027 negli USA e Euro 7 dal 2026-11, e il Regolamento delegato UE 2026/699 permette ai costruttori di autenticare gli strumenti diagnostici: i generici ELM327 potrebbero perdere compatibilita' sui modelli nuovi.

## Findings

### 1. ELM327 originali vs cloni: la stringa di versione non e' affidabile; i cloni 'v1.5'/'v2.1' sono quasi sempre firmware v1.4 copiato e mancano le funzioni v2.x  `[confidenza: high]`

FATTI. Elm Electronics ha rilasciato solo le versioni 1.0, 1.0a, 1.1, 1.2, 1.2a, 1.3, 1.3a, 1.4, 1.4b, 2.0, 2.1, 2.2, 2.3 (non esistono 1.4a ne' 1.5). Il firmware v1.4 era leggibile dal PIC senza protezione, quindi i cloni ne contengono una copia e molti dichiarano versioni piu' recenti o inesistenti ('ELM327 v1.5'). Car Scanner conferma: i numeri di versione (v1.5, v2.1) sono ormai falsificati anche nei dispositivi pessimi e non indicano qualita'.
COSA MANCA nei cloni (inferenza dalla storia versioni del datasheet, p.90-91): v2.0 aggiunge buffer TX 512 byte, Activity Monitor (ATAMC/ATAMT), ATCRA con caratteri 'X' (es. ATCRA 7EX), ATSH a 4 byte, mantenimento impostazioni dopo Low Power; v2.1 aggiunge rilevamento delle risposte 'response pending' (7F xx 78) con adattamento dei timeout, controllo frequenza CAN nelle ricerche, ATCTM1/ATCTM5. Quindi: NON dipendere da ATCRA 7EX, ATAMT, ATCTM5; gestire da soli le risposte 7F xx 78 (continuare ad aspettare), usare ATCRA con valore esatto (esiste da v1.3).
SONDA DI CAPACITA' (euristica mia, confidence media): dopo ATZ inviare ATAMC (v2.0+, innocuo, risponde un valore hex); se risponde '?' il firmware e' < 2.0 (clone o vecchio). Per ogni comando di configurazione trattare '?' come 'non supportato' senza abortire.
ADATTATORI STN (OBDLink, e probabilmente altri): ATI risponde 'ELM327 v1.4b' (emulazione) ma STI risponde es. 'STN2232 v5.10.3', STDI 'OBDLink MX+ r3.2.1', STDIX stampa info estese: inviare STI dopo ATZ; se non risponde '?' e' un chip STN e si possono usare comandi ST (es. STSLEEP). Exempio: >STI  -> STN2232 v5.10.3.
RACCOMANDAZIONI ADATTATORI (Car Scanner): consigliati OBDLink MX+ (MFi), OBDLink CX (BLE), vLinker MC+/MS/FS (inizialmente difettosi, ora affidabili dopo aggiornamenti firmware), Vgate iCar Pro 2S (BLE), Vgate iCar Pro (doppio chip 2.0+4.0, serve firmware >= 4.1.02 per CAN con indirizzamento esteso), Car2LS ScanX; da evitare: adattatori 'mini', sotto i 10 USD, MAC che inizia con 11:22:33 o 00:00:00, KONNWEI, Micro Mechanic, KUULAA, xTool. Decisione prodotto: supportare qualunque adattatore compatibile ELM327 ma mostrare un banner di qualita' (basato su ATI/STI e sulla sonda) e linkare alla lista consigliata.

Fonti:
- https://www.elmelectronics.com/wp-content/uploads/2016/07/ELM327DS.pdf
- https://en.wikipedia.org/wiki/ELM327
- https://www.carscanner.info/choosing-obdii-adapter/
- https://www.scantool.net/scantool/downloads/678/obdlink_frpm_e.pdf

### 2. Matrice trasporti/piattaforme: iOS = solo BLE (+WiFi, +pochi Classic MFi); Android = Classic SPP, BLE, WiFi. La baseline cross-platform e' BLE  `[confidenza: high]`

iOS NON puo' usare Bluetooth Classic SPP generico: serve certificazione MFi e il framework External Accessory. Adattatori Classic verificati per iOS: OBDLink MX+, vLinker FS, vLinker MS. Adattatori BLE usati su iOS (lista OBD Auto Doctor): Carista, CYEL, FIXD, Kiwi 3/4, LELink, MicroTech, OBDLink CX, Tonwon, UniCarScan, Veepeak, Vgate, Viecar, Yawoa. Su Android funzionano tutti i tipi.
Modelli: OBDLink MX+ = Bluetooth Classic v3.0 + MFi (iOS e Android); OBDLink LX = Classic, solo Android; OBDLink EX = USB; OBDLink CX = solo BLE 5.1, iOS+Android (ottimizzato BMW, non funziona con alcune GM/Ford/FCA pre-2008 secondo OBDLink). vLinker MC+ = BT 4.0 BLE (iOS/Android/Windows), vLinker MC = BT 3.0 (Android/Windows), vLinker FS/MS = MFi, BM+ = per BimmerCode. Veepeak OBDCheck BLE/BLE+ e Vgate iCar Pro = BLE economici molto diffusi.
Prestazioni: Car Scanner dichiara che il Classic e' piu' veloce e affidabile del BLE su Android (circa il 95% degli utenti Android usa Classic); su iOS il WiFi e' sconsigliato per instabilita'. (Un blog riporta ~8 Hz massimi per gli adattatori BLE ELM327: confidence bassa.)
IMPATTO PER L'APP: (1) implementare prima BLE (un solo trasporto per iOS+Android); (2) aggiungere WiFi/TCP (stesso protocollo testuale, costo basso); (3) Classic SPP come estensione solo Android (utile perche' molti utenti hanno gia' un ELM327 Classic); (4) NON investire inizialmente nel percorso MFi (programma Apple, protocolli per-accessorio come UISupportedExternalAccessoryProtocols, adattatore deve essere autorizzato). Nel flusso di onboarding chiedere 'che adattatore hai?' e su iOS avvisare che i Classic non funzionano. I nomi BLE annunciati sono tipicamente 'OBDII', 'obd2' o il marchio (es. 'Viecar'), quindi non filtrare per nome ma mostrare tutti i dispositivi con servizi noti.

Fonti:
- https://www.carscanner.info/?p=40
- https://www.obdautodoctor.com/help/articles/supported-obd-adapters/
- https://support.obdlink.com/support/solutions/articles/43000713351
- https://developer.apple.com/documentation/externalaccessory
- https://www.carscanner.info/choosing-obdii-adapter/
- https://www.amazon.com/vgate-vLinker-Bluetooth-Diagnostic-Android/dp/B088LW211V
- https://www.carscanner.info/?p=69

### 3. Bluetooth Classic (Android) e WiFi: parametri concreti di connessione  `[confidenza: medium]`

CLASSIC SPP: profilo RFCOMM con UUID standard 00001101-0000-1000-8000-00805F9B34FB (usato per esempio da android-obd-reader). Su Android l'adattatore va prima accoppiato dalle impostazioni di sistema; PIN tipici 1234, 0000, 7890, 1111 (Car Scanner). iOS BLE invece non richiede accoppiamento di sistema (Car Scanner). Alcuni dispositivi Bluetooth seriali richiedono il socket RFCOMM 'insecure' o la porta alternativa via reflection (caso CANblue; confidence bassa per gli ELM327): prevedere nel layer Classic un fallback secure -> insecure. Libreria: react-native-bluetooth-classic (MIT, supporta opzioni delimiter/charset/secureSocket, Android via BluetoothAdapter, iOS via External Accessory/MFi, RN >= 0.73): usare il delimiter '>' per leggere fino al prompt.
WIFI: la maggior parte degli ELM327 WiFi crea un access point con IP 192.168.0.10 e porta TCP 35000; il flusso e' identico al seriale (CR terminato, prompt '>'). Su iOS la prima connessione genera il prompt 'Rete locale' (serve NSLocalNetworkUsageDescription in Info.plist, per Apple scatta per TCP verso indirizzi locali) e senza consenso la connessione fallisce; inoltre il telefono perde internet mentre e' sull'AP dell'adattatore. Libreria TCP: react-native-tcp-socket 6.4.3 (MIT, ultima release 2026-09-10).
Tutti e tre i trasporti espongono lo stesso contratto: write(string) + stream di byte in ingresso + eventi di disconnessione; il resto (init, queue, parser) e' condiviso.

Fonti:
- https://github.com/pires/android-obd-reader
- https://www.carscanner.info/en/android-bluetooth/
- https://www.carscanner.info/wifi/
- https://www.carscanner.info/?p=394
- https://kenjdavidson.com/react-native-bluetooth-classic/
- https://developer.apple.com/documentation/bundleresources/information-property-list/nslocalnetworkusagedescription
- https://forum.hms-networks.com/t/canblue-ii-with-android/37042

### 4. UUID GATT usati di fatto dagli adattatori BLE: tabella con livello di verifica e algoritmo di selezione basato sulle proprieta'  `[confidenza: medium]`

TABELLA (UUID a 16 bit = 0000XXXX-0000-1000-8000-00805F9B34FB):
1) OBDLink CX (VERIFICATO da documentazione ufficiale OBDLink): servizio FFF0; FFF1 = notifiche (RX verso l'app); FFF2 = write + write-without-response (TX); anche 180A Device Information (nome, modello, firmware) e FEF5 (uso interno). MTU max 247.
2) Veepeak OBDCheck BLE/BLE+ e molti BLE 'generici': servizio FFF0, FFF1 notify (spesso read+notify), FFF2 write (confermato da thread Arduino/ESPHome; alcune fonti invertono FFF1/FFF2: quindi decidere dalle proprieta', non dal numero). Confidence media.
3) Vgate iCar Pro BLE: servizio 18F0, notify 2AF0, write 2AF1 (richiesta ABRP, 2021-12). Confidence media. [CONFERMATO dalla verifica: servizio primario 0x18F0; 0x2AF0 = INDICATE+NOTIFY, 0x2AF1 = WRITE + WRITE NO RESPONSE; fonte secondaria https://abrp.featurebase.app/p/i-plugged-an-obd-vgate-icar-pro-ble-40-unfortunatly-2]
4) Vgate iCar (BLE 4.0 per iOS, Swift/CoreBluetooth): servizio E7810A71-73AE-499D-8C15-FAA9AEF0C3F2 con UNA caratteristica BEF8D6C9-9C21-4C9E-B632-BD58C1009F9F (read/write/notify, scrittura con risposta). Confidence media. [DA VERIFICARE: la ricerca indipendente per la coppia di UUID E7810A71.../BEF8D6C9... non ha restituito alcuna fonte pertinente; trattarla come ipotesi da validare con l'adattatore reale]
5) Stile HM-10/CC2541: servizio FFE0, caratteristica FFE1 con write-without-response + notify, payload 20 byte (datasheet HM-10). Alias: FFF0/FFF1(write)/FFF2(notify) come alternativa nell'emulatore elm327emu.
6) Nordic UART Service: servizio 6E400001-B5A3-F393-E0A9-E50E24DCCA9E, RX (write) 6E400002-..., TX (notify) 6E400003-... (usato in hint matrix di app ELM327; per OBD confidence bassa).
7) Transparent UART Microchip/ISSC (49535343-FE7D-4AE5-8FA9-9FAFD205E455 con 49535343-8841-43F4-A8D4-ECBE34729BB3 write e 49535343-1E4D-4BD9-BA61-23C647249616 notify): UUID da mia memoria non verificati in questa sessione, confidence bassa. [DA VERIFICARE: la ricerca indipendente con i tre UUID non ha restituito fonti pertinenti; nessuna conferma ne' smentita]
ALGORITMO consigliato (come fanno react-native-bluetooth-obd-manager con KNOWN_ELM327_TARGETS e Flutter-OBD2 con greedy discovery): dopo connect + discoverAllServicesAndCharacteristics: (a) cerca nell'ordine i servizi noti [FFF0, FFE0, 18F0, E7810A71..., 6E400001, 49535343...]; (b) dentro il servizio scegli come NOTIFY la caratteristica con isNotifiable/isIndicatable e come WRITE quella con isWritableWithoutResponse (preferita per throughput) o isWritableWithResponse; se e' una sola caratteristica con entrambe, usa quella; (c) se nessun servizio noto combacia, prendi qualunque servizio non standard (non 1800/1801/180A) che abbia una caratteristica notify e una write; (d) memorizza per device-id la configurazione riuscita; (e) abilita le notifiche PRIMA del primo write (su OBDLink CX l'abbinamento si innesca alla sottoscrizione di FFF1 o alla scrittura su FFF2); (f) verifica con ATZ: se non arriva '>' entro 3 s, prova la configurazione successiva.

Fonti:
- https://support.obdlink.com/support/solutions/articles/43000746707-obdlink-cx-adapter-notes
- https://forum.arduino.cc/t/esp32-with-elm327/1315461
- https://abrp.featurebase.app/p/add-odb-support-for-vgate-icar-pro-bluetooth-40-ble-2
- https://developer.cloud.tencent.com/ask/sof/1648550
- https://github.com/poropi/elm327emu
- https://github.com/zsirafmix/elm327
- https://people.ece.cornell.edu/land/courses/ece4760/PIC32/uart/HM10/DSD%20TECH%20HM-10%20datasheet.pdf
- https://unpkg.com/react-native-bluetooth-obd-manager@1.0.4/README.md
- https://github.com/AceBurgundy/Flutter-OBD2

### 5. MTU, frammentazione, notifiche vs write-without-response e bonding sui BLE ELM327  `[confidenza: medium]`

MTU: ATT di default 23 byte = 20 byte utili per notifica/write. OBDLink CX supporta MTU fino a 247 (overhead 3 byte per write con risposta; documentazione OBDLink indica overhead maggiore per write-without-response); su Android il default e' 23 e si puo' chiedere fino a 517 [CORRETTO dalla verifica: il massimo GATT e' 517 (GATT_MAX_MTU_SIZE = 512 byte di attributo + 3 di header), non 512; fonte secondaria https://esp32.com/viewtopic.php?p=100030] con requestMTU e attendere onMtuChanged; su iOS l'MTU e' negoziato automaticamente (massimi 135/158/185 per iOS 8/9/10+ [DA VERIFICARE: corrispondenza versione/valore non riscontrata in fonte]; leggere maximumWriteValueLength). Android 14 (API 34) richiede automaticamente MTU 517 alla connessione e alcuni periferici non lo reggono (thread Nordic) [DA VERIFICARE: il thread Nordic non e' stato riletto in questa verifica; il massimo 517 e' confermato da fonte secondaria, l'invio automatico su Android 14 no]: non assumere MTU, leggere quello effettivo e non inviare mai piu' di MTU-3 byte [CORRETTO dalla verifica: la regola MTU-3 vale solo per la write con risposta; per OBDLink CX la documentazione indica overhead 3 byte per write.default() ma 12 byte per write.withoutResponse(), quindi con write-without-response il payload massimo e' MTU-12; irrilevante per i comandi ELM (<20 caratteri) ma da rispettare se si inviano blocchi piu' lunghi; fonte https://support.obdlink.com/support/solutions/articles/43000746707-obdlink-cx-adapter-notes]. I comandi ELM sono < 20 caratteri: una sola scrittura. Le risposte sono lunghe (fino a decine di byte) e arrivano SPEZZATE in piu' notifiche: bufferizzare i byte e considerare la risposta completa solo quando il buffer termina con '>' (il prompt puo' arrivare da solo nell'ultima notifica). Mai fare split per notifica.
WRITE: usare write-without-response se la caratteristica lo permette (throughput), altrimenti write con risposta; con write-without-response rispettare il controllo di flusso della libreria (su iOS canSendWriteWithoutResponse) e comunque inviare un solo comando alla volta (serializzazione, vedi finding dedicato). OBDLink non supporta le queued writes: eventuale chunking manuale.
NOTIFICHE: modello push; abilitare le notifiche (CCCD) prima del primo comando. Bonding: OBDLink CX abilita il bonding nei primi 5 minuti dall'alimentazione, comunicazioni cifrate sempre attive, PIN legacy 123456; l'accoppiamento puo' scattare alla sottoscrizione/scrittura: gestire il dialogo di sistema e il retry.
Riconnessione: al connect su Android attendere onConnectionStateChange poi discoverServices (con un breve ritardo ~300-600 ms su alcuni dispositivi per evitare 'status 133'); implementare backoff esponenziale (1s, 2s, 4s...) e ripetere l'init completo (ATZ...) dopo ogni riconnessione perche' lo stato dell'adattatore puo' essere stato resettato (LV RESET, sleep).

Fonti:
- https://support.obdlink.com/support/solutions/articles/43000746707-obdlink-cx-adapter-notes
- https://devzone.nordicsemi.com/f/nordic-q-a/115384/android-14-enforcing-mtu-size-517-causes-ota-issues-with-ble-5-0-device-firmware/506415
- https://unpkg.com/react-native-bluetooth-obd-manager@1.0.4/README.md

### 6. Sequenza di inizializzazione AT consigliata, con risposte attese, timeout e ricerca protocollo  `[confidenza: high]`

SEQUENZA (ogni riga = un comando terminato da CR, attendere '>' prima del successivo):
1) ATZ -> dopo 1-2 s arriva 'ELM327 v1.x/2.x' (i cloni anche 2.5 s; python-OBD aspetta 1 s, app Kotlin zsirafmix usa 8 s di timeout, thread Arduino ~2.5 s). Timeout consigliato 5 s. Dopo ATZ echo e linefeed tornano ON (default E1/L1).
2) ATE0 -> la risposta contiene ancora l'eco: 'ATE0\rOK\r\r>' (togliere l'eco confrontando con l'ultimo comando inviato; alcuni cloni ignorano ATE0, quindi togliere sempre l'eco anche dopo).
3) ATL0 (niente LF), ATS0 (niente spazi: ~-33% byte, aiuta su BLE), ATH1 (header ON, vedi finding ISO-TP). ATCAF1 e ATAT1 sono default (inviare ATAT1 esplicito va bene).
4) Timeout risposta: ATST hh = hh x 4 ms; default 0x32 (~200 ms); con adaptive timing attivo e' il massimo. Lasciare il default; alzare (ATST FF ~1 s) solo per ECU lente, Mode 04, K-line.
5) ATRV -> '12.4V' tensione sul pin 16 (python-OBD usa ATRV e richiede >= 6 V prima di procedere); utile per diagnosi 'accensione spenta' e per il log tensione.
6) ATSP0 (non scrive in EEPROM) e poi la prima richiesta reale 0100: l'adattatore risponde 'SEARCHING...' e prova i protocolli; puo' impiegare diversi secondi (python-OBD aspetta fino a 10 s [DA VERIFICARE: nel sorgente elm327.py consultato compaiono solo attese di 1 s dopo ATZ, dopo ATSP0 e per lo 0100 durante l'auto-rilevamento; il valore 10 s non e' stato riscontrato]). Se 'UNABLE TO CONNECT' -> accensione spenta/protocollo non supportato: aspettare e riprovare non piu' di una volta ogni 2-3 s.
7) ATDPN -> 'A6' (A = automatico, 6 = ISO 15765-4 CAN 11 bit 500k); ATDP da' il testo ('AUTO, ISO 15765-4 (CAN 11/500)'). Salvare il numero per veicolo; alla volta successiva usare ATTP6 (o ATTPA6 per ripiego automatico) invece di ATSP6 per non scrivere in EEPROM a ogni sessione (ATSP n salva sempre il protocollo e costa ~30 ms di scrittura). Con ATSP0 dopo un protocollo trovato l'ELM lo ricorda (memoria M1).
8) Ripiego se la ricerca automatica fallisce (alcuni cloni): ciclare ATTP n + 0100 con ordine python-OBD [6,8,1,7,9,2,3,4,5,A]; per il mercato EU preferibile [6,7,8,9,5,4,3,2,1].
9) Identificazione: ATI (versione), AT@1 (descrizione), STI/STDI (chip STN), poi 0100/0120/... e 0902.
PROTOCOLLI (ATSP/ATDPN): 0 auto; 1 J1850 PWM 41.6k; 2 J1850 VPW 10.4k; 3 ISO 9141-2 (init 5 baud); 4 ISO 14230-4 KWP (init 5 baud); 5 ISO 14230-4 KWP (init veloce); 6 CAN 11 bit 500k; 7 CAN 29 bit 500k; 8 CAN 11 bit 250k; 9 CAN 29 bit 250k; A J1939 29 bit 250k; B/C CAN utente. Con protocollo fisso (ATSP n con n!=0) un fallimento da' 'BUS INIT: ...ERROR' senza altre ricerche. Le K-line mostrano 'BUS INIT: ...' solo se non in auto-search; ISO 9141/KWP richiedono traffico ogni ~5 s: l'ELM invia da solo i messaggi di wake-up ogni 3 s (ATSW).

Fonti:
- https://www.elmelectronics.com/wp-content/uploads/2016/07/ELM327DS.pdf
- https://raw.githubusercontent.com/brendan-w/python-OBD/master/obd/elm327.py
- https://github.com/zsirafmix/elm327
- https://forum.arduino.cc/t/esp32-with-elm327/1315461
- https://py-obdii.readthedocs.io/en/latest/api/modes/mode_at.html

### 7. Grammatica delle risposte ELM327: righe informative, stringhe di errore, '?' e come reagire (politica di retry)  `[confidenza: high]`

STRUTTURA: ogni risposta termina con CR (+ LF se L1) e poi il prompt '>' ; l'ELM e' case-insensitive, ignora spazi e caratteri di controllo; possono comparire byte NULL (0x00) spuri da scartare (datasheet). Prima della prima risposta OBD puo' comparire 'SEARCHING...'.
STRINGHE (datasheet p.86-89) -> AZIONE:
- SEARCHING... : informativa, scartare la riga; la risposta vera segue.
- NO DATA : nessuna risposta entro ATST (PID/modo non supportato, ECU non ha dati, filtro CAN, accensione spenta). Riprovare 1 volta; poi marcare il PID 'non supportato'; se tutti i PID danno NO DATA -> chiedere accensione ON.
- UNABLE TO CONNECT : tutti i protocolli provati senza successo (chiave non su ON, protocollo non supportato) -> messaggio guidato + retry con pausa.
- BUS INIT: ...ERROR (o 'BUS INIT: ERROR') : handshake K-line fallito con protocollo fissato -> passare a ATSP0/altro protocollo.
- CAN ERROR / BUS ERROR / FB ERROR : problema CAN/cablaggio o baud sbagliato -> cambiare protocollo, segnalare adattatore difettoso.
- BUS BUSY : bus troppo attivo per inserire il messaggio -> pausa 100-300 ms e retry.
- DATA ERROR / <DATA ERROR : risposta ricevuta ma corrotta (checksum/formato, a volte CAF attivo su protocollo non ISO 15765-4) -> retry una volta.
- <RX ERROR : errore su frame CAN in ricezione/monitor.
- STOPPED : operazione interrotta perche' e' stato inviato un carattere prima del '>' (bug di serializzazione!).
- BUFFER FULL : buffer RS232 pieno (512 byte da v2.0) -> leggere piu' in fretta, ATCRA, ridurre ATH/ATS.
- LV RESET : reset per bassa tensione, torna ai default -> rieseguire l'init completo. ERR94 : errore CAN fatale con reset impostazioni; da v1.3a blocca le ricerche CAN fino al prossimo reset.
- ACT ALERT / LP ALERT : l'adattatore sta per andare in bassa potenza (LP ALERT 2 s prima) -> aspettarsi disconnessione. [CORRETTO dalla verifica, precisazione dal datasheet: ACT ALERT e' un preavviso di inattivita' (con timeout da inattivita' RS232 arriva circa 1 minuto prima) e inviare qualsiasi carattere entro il minuto annulla il passaggio a low power; LP ALERT e' l'avviso a 2 s e a quel punto 'nessun input puo' fermare l'azione'. Un '!' davanti all'avviso compare se PP 0F bit 1 = 1.]
- '?' : comando non capito (errore, o comando non supportato dal clone): per le sonde AT significa 'non supportato'.
RISPOSTE NEGATIVE UDS/J1979: 7F <servizio> <NRC>: NRC 0x78 'response pending' = continuare ad aspettare (v2.1+ lo gestisce da solo; i cloni no); 0x11/0x12/0x31 = servizio/sub-funzione/richiesta non supportati -> PID non supportato; 0x22 'conditions not correct' (tipico di Mode 04 con motore acceso; confidence media sul significato degli NRC, standard ISO 14229).
TIMEOUT consigliati lato app: AT config 1 s; richieste Mode 01 2 s; 0100 dopo ATSP0 15 s; 0902/03/07/0A 3-5 s; Mode 04 5 s; ISO 9141/KWP init 8 s.

Fonti:
- https://www.elmelectronics.com/wp-content/uploads/2016/07/ELM327DS.pdf
- https://raw.githubusercontent.com/brendan-w/python-OBD/master/obd/elm327.py

### 8. Serializzazione dei comandi, velocita' di polling e tecniche per accelerare (digit del numero di risposte, CR di ripetizione, multi-PID)  `[confidenza: high]`

REGOLE: (1) un solo comando in volo; il datasheet impone di attendere il prompt '>' prima del comando successivo: qualunque carattere ricevuto durante un'operazione la interrompe e produce 'STOPPED'. (2) Inviare solo CR (0x0D) come terminatore. (3) Una coda FIFO con priorita' (comandi utente > polling), un mutex implicito (promise chain) e un timeout per comando; allo scadere inviare un singolo CR per forzare il ritorno al prompt e, se non arriva '>', riconnettere.
VELOCITA': timeout predefinito ~200 ms, con Adaptive Timing (ATAT1 default; ATAT2 piu' aggressivo) l'adattatore misura i tempi reali: esempio del datasheet con timeout ~90 ms = circa 6 letture/s. Aggiungendo alla richiesta una cifra hex col numero massimo di risposte attese (es. '010C1', '0100 2') l'adattatore ritorna subito dopo N risposte (10-12 letture/s nell'esempio), ma se N e' minore delle risposte reali alcuni protocolli (J1850 PWM) non inviano gli ack e si crea traffico: usarlo solo su CAN dopo aver fissato l'ECU con ATSH 7E0 + ATCRA 7E8, oppure con N noto. Il CR da solo ripete l'ultimo comando (trucco ELM, utile per polling di un solo PID).
MULTI-PID (solo CAN): fino a 6 PID in una richiesta, es. '01 0B 04 0C 05' -> una risposta '41 0B 21 04 3F 0C 17 B8 05 44' = MAP 33 kPa, carico 0x3F x100/255=24.7%, RPM 0x17B8/4=1518, ECT 0x44-40=28 C. Risparmia round trip ma complica il parsing (serve la lunghezza dati per PID): usarlo solo per la modalita' 'live' e con tabella lunghezze PID.
DESIGN: per le sessioni 'snapshot' di manutenzione (VIN, 0101, DTC, ~15 PID) bastano 5-8 secondi in sequenza; per il 'live' lavorare a 4-8 Hz massimo e scaglionare i PID (giri/velocita' ogni ciclo, temperature ogni 10 cicli, tensione ogni 20). Non fare polling in background (batteria auto e policy).

Fonti:
- https://www.elmelectronics.com/wp-content/uploads/2016/07/ELM327DS.pdf

### 9. Risposte multi-linea e ISO-TP: formato con ATH0/CAF1 ('014', '0:', '1:'), perche' conviene ATH1, algoritmo di riassemblaggio e trascrizioni  `[confidenza: high]`

MODO ATH0 + ATCAF1 (default): l'ELM327 riassembla da se' i frame ISO 15765-4: la prima riga e' la lunghezza in byte in 3 cifre hex, poi righe numerate '0:' '1:' '2:'... (indice 0-F ciclico). Esempio VIN (sintetico, stesso formato del datasheet):
>0902
014
0: 49 02 01 5A 46 41
1: 31 39 39 30 30 30 30
2: 31 32 33 34 35 36 37
(0x14=20 byte = 3 intestazione 49 02 01 + 17 caratteri VIN = 'ZFA19900001234567'). PROBLEMA: con piu' ECU che rispondono (es. 0904 su motore e cambio) le righe si MESCOLANO e non si sa a quale ECU appartengono (il datasheet mostra proprio questo caso con due blocchi '013' e due frame '2:'). Soluzioni: (a) ATH1 + parser ISO-TP proprio (consigliata); (b) fissare un'ECU con ATSH 7E0 e ATCRA 7E8.
MODO ATH1: l'adattatore stampa i frame grezzi con CAN-ID e byte PCI, senza riassemblare:
>0902
7E8 10 14 49 02 01 5A 46 41
7E8 21 31 39 39 30 30 30 30
7E8 22 31 32 33 34 35 36 37
(il Flow Control 30 00 00 verso la 7E0 lo invia da solo l'adattatore.) Frame singolo: '7E8 03 41 05 7B 00 00 00 00' dove il primo byte e' il PCI = lunghezza utile (03) e i byte finali 00 sono padding da ignorare.
ALGORITMO (CAN, protocolli 6-9): per ogni riga: separare ID (3 hex per 11 bit, 8 hex per 29 bit; con ATS0 usare il numero di protocollo da ATDPN per sapere la lunghezza: 6/8 = 11 bit, 7/9 = 29 bit) dai byte; PCI = byte0: nibble alto 0 = Single Frame (len = nibble basso, dati da byte1), 1 = First Frame (len = ((b0&0x0F)<<8)|b1 fino a 4095, dati da byte2), 2 = Consecutive Frame (seq = b0&0x0F, dati da byte1), 3 = Flow Control (ignorare). Raggruppare per ID (ECU), ordinare i CF per seq (cicla 0-F), concatenare e troncare alla lunghezza. ID risposta: 11 bit 7E8-7EF (richiesta funzionale 7DF, fisica 7E0-7E7); 29 bit: funzionale 18 DB 33 F1, fisica 18 DA <ECU> F1, risposta 18 DA F1 <ECU> (priorita' 18; l'ELM327 riempie DB/33/F1 con ATSH).
ALGORITMO non-CAN (protocolli 1-5, con ATH1): ogni riga = 3 byte header + dati + 1 checksum, es. '48 6B 10 41 00 BE 3E B8 11 FA' (ECU 10 motore, 18 cambio): scartare i primi 3 e l'ultimo byte. VIN su J1850 = 5 messaggi con indice: '49 02 01 00 00 00 5A', '49 02 02 46 41 31 39', ... (4 byte dati per riga, i primi 3 zero sono filler): ordinare per indice (3o byte).
Con piu' ECU anche 0100 risponde piu' volte: unire (OR) i bitmask delle ECU o tenere un bitmask per ECU. Testare con trascrizioni sia ATH0 (ambigue) sia ATH1.

Fonti:
- https://www.elmelectronics.com/wp-content/uploads/2016/07/ELM327DS.pdf
- https://raw.githubusercontent.com/brendan-w/python-OBD/master/obd/protocols/protocol_can.py
- https://en.wikipedia.org/wiki/OBD-II_PIDs

### 10. PID supportati: bitmask 0100/0120/0140/0160/0180/01A0/01C0 con algoritmo ed esempio completo  `[confidenza: high]`

Richiesta 0100 -> risposta '41 00 A B C D' (4 byte = 32 bit, MSB del byte A = PID 01, LSB del byte D = PID 20). Il PID 0x20, 0x40, 0x60, 0x80, 0xA0, 0xC0 sono i 'puntatori' al blocco successivo: interrogare 0120 solo se il bit PID 20 e' 1, 0140 solo se il bit 40 e' 1, ecc. (stesso schema per Mode 02 e Mode 09: 0900).
ESEMPIO: '41 00 BE 3E B8 11' -> BE=1011 1110 -> PID 01,03,04,05,06,07; 3E=0011 1110 -> 0B,0C,0D,0E,0F; B8=1011 1000 -> 11,13,14,15; 11=0001 0001 -> 1C e 20. Totale: 01 03 04 05 06 07 0B 0C 0D 0E 0F 11 13 14 15 1C 20 (il bit 20 e' 1: leggere anche 0120). Pseudocodice: for i in 0..3: for bit in 0..7: if byte[i] & (0x80 >> bit): pid = i*8+bit+1.
NOTE: (1) il bitmask e' un'indicazione, non una garanzia: alcune ECU lo dichiarano e poi rispondono NO DATA, altre rispondono a PID non dichiarati; costruire la lista 'supportati' = dichiarati E risposti almeno una volta; (2) con piu' ECU unire i mask; (3) memorizzare per VIN (cache) per saltare la discovery alle sessioni successive e invalidare se cambia protocollo/ECU; (4) NO DATA su 0100 con motore spento ma accensione ON puo' avvenire su ECU in sleep: riprovare dopo 1 s.
Un'ECU puo' rispondere anche a ATH0 con righe multiple '41 00 BE 3E B8 11' e '41 00 98 18 00 01' (esempio illustrativo): sono due ECU (motore e cambio).

Fonti:
- https://www.elmelectronics.com/wp-content/uploads/2016/07/ELM327DS.pdf
- https://en.wikipedia.org/wiki/OBD-II_PIDs

### 11. PID 0101 (stato MIL, numero DTC, monitor di prontezza): decodifica bit per bit con esempio  `[confidenza: medium]`

Risposta '41 01 A B C D'.
Byte A: bit7 = MIL (1 = spia motore accesa); bit6..0 = numero DTC confermati emissioni (0-127).
Byte B: bit7 riservato (0); bit3 = tipo motore (0 = benzina/accensione comandata, 1 = diesel/accensione per compressione); bit2..0 = DISPONIBILITA' dei test comuni (1 = il monitor esiste), nell'ordine J1979 bit0 = misfire, bit1 = fuel system, bit2 = components; bit6..4 = COMPLETEZZA, stesso ordine (bit4 misfire, bit5 fuel system, bit6 components) con logica invertita: 0 = completo/pronto, 1 = non completo. (La struttura B2-B0 disponibilita' e B6-B4 completezza e' confermata da Wikipedia; l'ordine per-bit misfire/fuel/components deriva da J1979 come riportato da fonti secondarie e dal decoder python-OBD: confidence medio-alta, da verificare su un'auto reale.) [CONFERMATO dalla verifica: la tabella Wikipedia riporta esplicitamente Components B2 (disponibilita') / B6 (completezza), Fuel System B1 / B5, Misfire B0 / B4, B3 = 0 benzina / 1 diesel, B7 riservato; resta consigliata la prova su auto reale, J1979 non consultato direttamente.] [DA VERIFICARE: nel byte C benzina Wikipedia riporta solo 'Gasoline Particulate Filter' per C4/D4; la dicitura 'A/C refrigerant nelle versioni vecchie' usata sopra non e' stata riscontrata.]
Byte C = disponibilita' e byte D = completezza (0 = completo) dei test specifici del tipo motore. Benzina: bit0 catalizzatore, bit1 catalizzatore riscaldato, bit2 EVAP, bit3 aria secondaria, bit4 GPF (o A/C refrigerant nelle versioni vecchie), bit5 sonda O2, bit6 riscaldatore sonda O2, bit7 EGR/VVT. Diesel: bit0 NMHC, bit1 NOx/SCR, bit3 pressione di sovralimentazione, bit5 sensore gas di scarico, bit6 filtro PM (DPF), bit7 EGR/VVT.
ESEMPIO (sintetico): '41 01 82 07 65 04' -> A=0x82: MIL=1, 2 DTC; B=0x07: benzina, misfire/fuel/components tutti disponibili e completi; C=0x65 (0110 0101): disponibili catalizzatore, EVAP, sonda O2, riscaldatore O2; D=0x04: bit2 = 1 -> EVAP NON completo. In UI: 'Spia MIL accesa, 2 codici; monitor EVAP non ancora pronto'.
Questi flag si azzerano con Mode 04 (vedi finding dedicato) e tornano 'completi' solo dopo specifici cicli di guida.

Fonti:
- https://en.wikipedia.org/wiki/OBD-II_PIDs
- https://raw.githubusercontent.com/brendan-w/python-OBD/master/obd/decoders.py
- https://www.elmelectronics.com/wp-content/uploads/2016/07/ELM327DS.pdf

### 12. Tabella PID Mode 01 utili alla manutenzione: byte, formule esatte ed esempi di trascrizione  `[confidenza: high]`

Richiesta '01 PP', risposta '41 PP data...' (A = primo byte dati). Formule (SAE J1979 come riportate da Wikipedia/CSS Electronics/DashLogic):
- 0104 carico motore calcolato: 1 byte, A*100/255 %. Es '41 04 80' -> 50.2%.
- 0105 temperatura liquido refrigerante: A-40 C. Es '41 05 7B' -> 123-40 = 83 C.
- 010C giri motore: 2 byte, (256*A+B)/4 rpm. Es '41 0C 1A F8' -> 6904/4 = 1726 rpm.
- 010D velocita': A km/h. Es '41 0D 3C' -> 60 km/h.
- 010F temperatura aria aspirata: A-40 C.
- 0110 MAF: (256*A+B)/100 g/s. Es '41 10 03 E8' -> 10.00 g/s.
- 0111 posizione farfalla: A*100/255 %.
- 011F tempo dall'avviamento motore: 2 byte, 256*A+B secondi. Es '41 1F 01 2C' -> 300 s.
- 0121 distanza con MIL accesa: 256*A+B km. 0131 distanza da cancellazione DTC: 256*A+B km (satura a 65535). 0130 warm-up dalla cancellazione: A (conteggio).
- 012F livello serbatoio: A*100/255 %. Es '41 2F 80' -> 50.2%.
- 0133 pressione barometrica: A kPa.
- 0142 tensione modulo di controllo: (256*A+B)/1000 V. Es '41 42 38 A4' -> 14500/1000 = 14.5 V.
- 0146 temperatura ambiente: A-40 C.
- 0151 tipo carburante: A = 1 benzina, 4 diesel, 8 elettrico, 17 ibrido benzina, 20 ibrido elettrico (lista parziale, Wikipedia).
- 015C temperatura olio motore: A-40 C. Es '41 5C 5A' -> 50 C.
- 015E consumo istantaneo (fuel rate): (256*A+B)/20 L/h. Es '41 5E 01 F4' -> 25.0 L/h.
- 011C standard OBD del veicolo: 1 = OBD-II CARB, 6 = EOBD (Europa), 7 = EOBD+OBD-II, 9 = EOBD+OBD+OBD-II, 11 = JOBD+OBD-II.
- 015B vita residua batteria ibrida: A*100/255 % (opzionale).
- 014D/014E tempo con MIL on / dalla cancellazione: 256*A+B minuti.
- 0106-0109 correzioni carburante: A*100/128 - 100 % (range -100..99.2).
- 010B MAP: A kPa; 010A pressione carburante: 3*A kPa; 010E anticipo: A/2-64 gradi.
- 01A6 odometro: 4 byte, (A*2^24+B*2^16+C*2^8+D)/10 km. Es '41 A6 00 01 E2 40' -> 123456/10 = 12345.6 km; 0xFFFFFFFF = non disponibile (convenzione, vedi OBFCM) [DA VERIFICARE: il sentinel 0xFFFFFFFF e' attestato solo dal progetto obfcm per il Mode 09 0x17, non per il PID 01A6; ne' Wikipedia ne' CSS Electronics lo riportano].
Implementazione: tabella dichiarativa {pid, bytes, decode(bytes[]), unit}; verificare sempre la lunghezza attesa e scartare risposte piu' corte; valori 0xFF per 'non disponibile' su alcuni sensori.

Fonti:
- https://en.wikipedia.org/wiki/OBD-II_PIDs
- https://www.dashlogic.com/docs/technical/obdii_pids
- https://www.csselectronics.com/pages/obd2-pid-table-on-board-diagnostics-j1979
- https://www.elmelectronics.com/wp-content/uploads/2016/07/ELM327DS.pdf

### 13. Cosa i veicoli supportano DAVVERO: 012F, 015C, 015E, 0142, 01A6 e contatori di distanza non sono garantiti  `[confidenza: medium]`

- 012F livello carburante: molti veicoli rispondono, ma alcune auto europee su CAN non espongono il PID standard e richiedono Mode 22 specifico (es. 22F42F segnalato in un forum RealDash/Traccar) o non lo espongono affatto. Trattare come 'opzionale', lettura smussata (media mobile) perche' il serbatoio oscilla.
- 015C temperatura olio: supporto limitato; su alcune marche (es. BMW) il PID generico risponde 'non valido' e il dato e' raggiungibile solo con protocollo di marca. Non promettere l'avviso temperatura olio: farlo solo se il PID e' dichiarato nel bitmask e risponde.
- 015E fuel rate (L/h): definito ma poco usato (alcune fonti lo descrivono come flusso iniettori e 'raramente usato').
- 0142 tensione modulo: di norma supportato sulle auto recenti, e' la tensione vista dall'ECU (con motore acceso ~13.8-14.7 V). Differisce da ATRV che e' la tensione sul pin 16 misurata dall'adattatore.
- 01A6 odometro: PID aggiunto nelle revisioni recenti di J1979(-DA/-2); Wikipedia riporta che dal 2019 la California (CARB) ne richiede la segnalazione, ma il supporto e' dipendente dal costruttore e 'molte auto non rispondono': l'app deve fare la sonda e ripiegare sull'inserimento manuale. (Il Mode 09 PID 0x17 per OBFCM, obbligatorio UE dal 2021, contiene la distanza totale in vita: vedi finding Mode 09; il controllo scantool della revisione italiana legge VIN e km, ma il meccanismo non e' documentato nelle fonti trovate.)
- 0131/0121/0130/011F: contatori di emissioni; ottimi per DERIVARE km tra sessioni (vedi finding derivabili) ma si azzerano con Mode 04 e 0131 satura a 65535 km.
- 0151 tipo carburante: utile per distinguere benzina/diesel/ibrido/elettrico e abilitare/disabilitare funzioni.
STRATEGIA: capability probing a ogni nuovo VIN (bitmask + una lettura di prova), salvare per veicolo una scheda 'cosa risponde', e costruire la UI sui dati disponibili, non su una lista teorica di PID.

Fonti:
- https://en.wikipedia.org/wiki/OBD-II_PIDs
- https://forum.realdash.net/t/obd2-ford-fuel-level-code/4568
- https://www.e46fanatics.com/threads/oil-temperature-via-obd.1106967/
- https://www.obdautodoctor.com/help/articles/supported-obd-parameters/

### 14. Mode 09: VIN (0902) con parsing multi-frame, 0904 calibration ID, 090A nome ECU; piu' OBFCM (0917) da trattare come pista  `[confidenza: medium]`

INFOTYPE Mode 09 (Wikipedia): 00 bitmask supportati, 01 conteggio messaggi VIN, 02 VIN (17 byte), 03 conteggio CALID, 04 Calibration ID (16-64 byte), 05 conteggio CVN, 06 CVN (4-16 byte), 07 conteggio IPT, 08 performance tracking benzina, 09 conteggio nome ECU, 0A nome ECU (20 byte). Risposta '49 PP NN dati' con NN = numero progressivo del messaggio.
VIN: richiesta '0902' -> risposta '49 02 01 + 17 byte ASCII'. CAN ATH0: '014' + righe '0:' '1:' '2:' (vedi esempio nel finding ISO-TP) -> togliere i 3 byte '49 02 01' e convertire gli ultimi 17 byte in ASCII; J1850: 5 righe '49 02 0n' con 4 byte ciascuna (filler 00 iniziali da ignorare). Validazione: 17 caratteri, alfabeto senza I, O, Q; il check digit (posizione 9) e' obbligatorio solo in Nord America, in UE non va imposto. Non tutte le auto vecchie supportano 0902 (datasheet): fallback = inserimento manuale + OCR del libretto.
Calibration ID '0904': '49 04 01 + n*16 byte ASCII' con padding 00; con ECU multiple i frame si mescolano (usare ATH1). Esempio bitmask: '0900' -> '49 00 55 40 00 00' = supportati 02 (VIN), 04 (CALID), 06 (CVN), 08, 0A (nome ECU).
Utilizzo in app: VIN come chiave del veicolo (con dialogo di conferma 'e' la tua auto?'), CALID/nome ECU per diagnosi e per capire il software (utile per profili marca).
OBFCM (PISTA, confidence BASSA): [CORRETTO dalla verifica: l'obbligo di dotare i veicoli nuovi (M1/N1) di dispositivi OBFCM, dal 2021-01-01 per le nuove immatricolazioni, deriva dal Reg. UE 2018/1832 (Allegato XXII); il Reg. UE 2021/392 riguarda invece monitoraggio e trasmissione dei dati letti, anche durante le ispezioni; fonti (risultati di ricerca) https://www.adac.de/rund-ums-fahrzeug/ausstattung-technik-zubehoer/assistenzsysteme/obfcm/ , https://www.oeamtc.at/thema/autokauf/obfcm-on-board-fuel-consumption-monitoring-48996822] il regolamento UE 2018/1832 impone dal 2021-01-01 di memorizzare consumo totale di carburante (litri) e distanza totale (km) in vita; progetti pubblici indicano [DA VERIFICARE: l'identificativo 0x17 compare solo nel progetto amatoriale obfcm, che cita SAE J1979-DA a pagamento e non e' presente nella tabella Mode 09 di Wikipedia (infotype 00-0B)] Mode 09 infotype 0x17 ('0917' con header 7E0, alias UDS 22F817), 16 byte: distanza recente A-D/10 km, distanza in vita E-H/10 km, carburante recente I-L/100 L, carburante in vita M-P/100 L (big-endian, 0xFFFFFFFF = n.d.). Il layout NON e' verificato (progetto obfcm: verified=False; la pagina del progetto dichiara il layout confermato su UN solo veicolo, un Ford E-350 2020 USA, e richiede almeno 3 veicoli diversi per marcarlo verified; il dato 'circa 12% dei veicoli restituisce dati corrotti, resettabile' [DA VERIFICARE: non riscontrato nella pagina consultata]). Fonte: https://github.com/Anush-aj/obfcm Se confermato su auto reali potrebbe fornire un 'km in vita' per le auto UE dal 2021 e il consumo medio reale.

Fonti:
- https://en.wikipedia.org/wiki/OBD-II_PIDs
- https://www.elmelectronics.com/wp-content/uploads/2016/07/ELM327DS.pdf
- https://github.com/Anush-aj/obfcm
- https://forums.ross-tech.com/index.php?threads/36805/

### 15. DTC: Mode 03/07/0A e Mode 02 (freeze frame): decodifica esatta P/C/B/U, formati CAN vs non-CAN, esempi  `[confidenza: high]`

RICHIESTE/RISPOSTE: 03 -> 43 (DTC memorizzati/confermati), 07 -> 47 (pendenti, ciclo corrente/ultimo), 0A -> 4A (permanenti, cancellabili solo dall'ECU), tutte senza PID. Ogni DTC = 2 byte.
DECODIFICA: byte1 bit7-6 = lettera (00 P, 01 C, 10 B, 11 U); bit5-4 = prima cifra (0-3); bit3-0 = seconda cifra hex; byte2 = ultime due cifre hex. Tabella per nibble alto: 0-3 -> P0-P3, 4-7 -> C0-C3, 8-B -> B0-B3, C-F -> U0-U3. Esempi: 01 33 -> P0133; C1 00 -> U0100; D0 16 -> U1016; 81 23 -> B0123; 41 23 -> C0123. '00 00' = slot vuoto (non e' un codice).
FORMATI: non-CAN (J1850/ISO9141/KWP): '43' + 3 slot da 2 byte, completati con 00 00: es. '43 01 33 C1 00 00 00' = P0133, U0100; oltre 3 DTC arrivano piu' messaggi. CAN (ISO 15765-4): dopo '43' c'e' un byte con il NUMERO di DTC: single frame '43 02 01 33 C1 00' (ATH0), con 3 DTC '008 / 0: 43 03 01 33 C1 00 / 1: 42 20' (ATH0), cioe' P0133, U0100, C0220; senza codici '43 00'. Con ATH1: '7E8 10 08 43 03 01 33 C1 00' + '7E8 21 42 20 00 00 00 00 00'. Alcune ECU rispondono NO DATA a 07/0A se non supportati. Con piu' ECU unire i codici per ECU (CAN ID).
RELAZIONE con 0101: il contatore in 0101 conta solo i DTC emissioni confermati dell'ECU motore/cambio; i DTC ABS/airbag/carrozzeria (C/B/U di altre centraline) NON sono generalmente raggiungibili con Mode 03: servono servizi UDS/KWP di marca (es. ReadDTCInformation 0x19) con indirizzo ECU proprietario; Torque/OBD Fusion li offrono solo con add-on 'enhanced'.
FREEZE FRAME (Mode 02): richiesta '02 PID 00' (PID + numero frame 00), risposta '42 PID 00 dati'. '02 02 00' -> '42 02 00 01 33' (DTC che ha generato il freeze frame = P0133; 0000 = nessun freeze frame e gli altri dati non hanno senso); '02 05 00' -> '42 05 00 7B' (ECT 83 C al momento del guasto); '02 0C 00' -> giri al guasto. Stesse formule del Mode 01. Mode 02 va letto PRIMA di un eventuale Mode 04.
DESCRIZIONI DTC: servono tabelle SAE J2012 (a pagamento) e in italiano; pista open: dtc-lookup (MIT, J2012 generici + tabelle per costruttore) e dataset obd2hq (JSON, multilingua, licenza da verificare). Tradurre/curare internamente i P0xxx/P2xxx piu' comuni.

Fonti:
- https://en.wikipedia.org/wiki/OBD-II_PIDs
- https://www.elmelectronics.com/wp-content/uploads/2016/07/ELM327DS.pdf
- https://github.com/Gershy13/dtc-lookup
- https://datahub.io/obd2hq-open-automotive-diagnostic-resources/obd2hq-diagnostic-resources
- https://www.motor.com/wp-content/uploads/2025/10/MOTOR_DiagnosticTroubleCodes.pdf

### 16. Mode 04 (cancellazione DTC): effetti collaterali, contesto revisione italiana e requisiti UX di avviso/conferma  `[confidenza: high]`

EFFETTI (datasheet ELM327 p.35): Mode 04 azzera il contatore DTC, cancella i DTC, il freeze frame e il DTC che l'ha generato, i dati dei test delle sonde O2, le informazioni Mode 06/07; NON cancella i DTC permanenti (Mode 0A), che spariscono solo quando l'ECU li riesamina. Le informazioni sono perse immediatamente; il veicolo puo' girare male per breve tempo durante la ricalibrazione. Come conseguenza (J1979) i monitor di prontezza tornano 'non completi' e devono ripassare i cicli di guida (0101 bytes B-D) [DA VERIFICARE: questo specifico effetto NON e' elencato nel datasheet ELM327 (che cita contatore DTC, DTC, freeze frame, dati sonde O2, Mode 06/07) e J1979 non e' consultabile gratuitamente; e' comunque l'effetto universalmente riportato dai costruttori di tool, da confermare su un'auto reale con 0101 prima/dopo]. Risposta positiva '44'. Alcuni veicoli la accettano solo con accensione ON e motore SPENTO (il datasheet ELM327 lo conferma); altrimenti risposta negativa tipo '7F 04 22' [DA VERIFICARE: il codice NRC 0x22 non e' nel datasheet ne' in altra fonte consultata, J1979 e' a pagamento]. Lo standard prevede che sia lo strumento a chiedere conferma ('Are you sure?'): l'ELM327 non lo fa.
CONTESTO ITALIA (Dekra su DD 11-08-2023 e circolare MIT 33287 del 07-11-2023; Sicurauto) [CORRETTO dalla verifica: nel documento Dekra (https://revisione.dekra.it/sites/default/files/Il%20nuovo%20controllo%20Scantool%20OBD.pdf) il 24-02-2024 e' la data 'dal' quale i centri devono dotarsi di strumento OBD idoneo e omologato (contestualmente alla prima scadenza di taratura degli altri strumenti), con aggiornamento software PCP/PCS entro il 2024-01-31; non e' una data di decorrenza uniforme del controllo sui singoli veicoli. Se lo scantool non comunica, dopo 120 s di attesa il test e' registrato come incompleto con esito regolare]: dal 24-02-2024 (centri attrezzati) la revisione per M1, M2, N1 Euro 5/6 immatricolati dal 2009-09-01 include controllo visivo della spia MIL (deve essere accesa a quadro acceso/motore spento e spenta a motore avviato) e lettura strumentale via scantool OBD; esito IRREGOLARE se il MIL risulta acceso, a prescindere dal numero di errori. Il controllo legge anche VIN e km (incoerenze segnalate ma non determinanti) e per i veicoli immatricolati dal 2021-01-01 i dati OBFCM (con possibile opposizione del proprietario). La procedura descritta non cita i monitor di prontezza, ma cancellare i codici non risolve il guasto: la spia si riaccende se il difetto e' presente.
REQUISITI UX/LEGALI (raccomandati): (1) pulsante 'Cancella codici' dietro doppia conferma esplicita con testo chiaro: 'Cancella DTC, freeze frame, dati dei test e resetta i monitor di prontezza; i codici permanenti restano; l'auto potrebbe non risultare pronta per la revisione'; (2) prima della cancellazione salvare automaticamente nello storico DTC + freeze frame + stato 0101 (backup consultabile ed esportabile); (3) bloccare/avvisare se il motore e' acceso (giri > 0) e se la tensione e' bassa; (4) non presentare mai la funzione come modo per 'superare la revisione'; (5) disabilitata di default dietro impostazione 'modalita' avanzata'; (6) log dell'azione con timestamp.

Fonti:
- https://www.elmelectronics.com/wp-content/uploads/2016/07/ELM327DS.pdf
- https://revisione.dekra.it/sites/default/files/Il%20nuovo%20controllo%20Scantool%20OBD.pdf
- https://www.sicurauto.it/b2b-auto-flotte/revisione-auto-tramite-obd-cosa-cambia-dal-2024
- https://www.alvolante.it/da_sapere/legge-e-burocrazia/spia-nel-cruscotto-auto-fa-bocciare-revisione-417245

### 17. Cosa NON e' disponibile con OBD-II standard: elenco onesto di cosa si puo' e non si puo' promettere  `[confidenza: high]`

NON DISPONIBILI via PID standard J1979 (richiedono Mode 22/UDS, KWP o protocolli proprietari per marca/modello/anno, oppure non sono proprio esposti): livello olio (misura) e vita residua olio (oil life %), intervallo di service/ispezioni (contatore 'service in X km'), pressione pneumatici TPMS (dato nella rete CAN di carrozzeria, proprietario), usura pastiglie (spesso solo un sensore on/off letto da centralina freni), stato di salute/SoH batteria 12V (BMS/IBS proprietari), chilometraggio sulla maggior parte delle auto (01A6 opzionale) [CORRETTO dalla verifica: precisazione necessaria. Secondo Wikipedia (https://en.wikipedia.org/wiki/OBD-II_PIDs) dal model year 2019 la California (CARB) impone a tutti i veicoli di fornire l'odometro, quindi 01A6 e' atteso sulle auto certificate CARB/USA recenti; per auto EU/EOBD nessun obbligo e' emerso dalle fonti consultate. La frase 'la maggior parte delle auto non risponde' e' una generalizzazione senza fonte: formulare onestamente come 'supporto variabile, da sondare per ogni veicolo; non garantito, in particolare sulle auto europee'], DTC di ABS/airbag/carrozzeria (altre ECU), dati EV/ibride (SoC, SoH, celle, temperature pacco: manufacturer UDS; per i BEV non esiste uno standard concordato per i PID della batteria). Tesla non usa l'OBD-II in senso tradizionale.
DISPONIBILI con ragionevole probabilita' (da verificare per veicolo): VIN, stato MIL e DTC emissioni (motore/cambio), freeze frame, prontezza monitor, temperatura refrigerante, giri, velocita', carico, temperatura aria aspirata, tensione modulo ECU, tipo carburante, spesso livello carburante, tempo motore dall'avvio, km dalla cancellazione DTC.
PROMESSE ONESTE PER L'APP: 'Leggi i codici guasto del motore, spia MIL, VIN e dati live standard con la tua auto'; 'tagliandi, assicurazione, scadenze, cambio olio e livelli si inseriscono manualmente o si stimano'; 'dati extra per marca/modello: a seconda della compatibilita' (profili verificati)'. NON scrivere in marketing 'legge livello olio, pressione gomme, usura freni, salute batteria' come funzioni generiche. Mostrare nella scheda veicolo una checklist 'Dati letti dalla tua auto / non disponibili su questo veicolo'.
SULL'AFFIDABILITA' dei dati: un'app deve esporre il 'livello di confidenza' (letto direttamente / stimato / inserito dall'utente) per ogni valore.

Fonti:
- https://en.wikipedia.org/wiki/OBD-II_PIDs
- https://www.elmelectronics.com/wp-content/uploads/2016/07/ELM327DS.pdf
- https://obdllm.com/en/blog/ev-hybrid-obd-diagnostics-tesla-nissan-leaf/
- https://www.mdpi.com/2624-8921/4/4/64
- https://www.obdautodoctor.com/help/articles/supported-obd-parameters/

### 18. Come Car Scanner, Torque Pro, OBD Fusion e Carly ottengono dati per marca, e implicazioni di licenza/legalita' dei database PID  `[confidenza: medium]`

MECCANISMO COMUNE: richieste Mode 22 (UDS ReadDataByIdentifier: richiesta '22 DID_hi DID_lo' -> '62 DID dati', es. '22 11 6B' -> '62 11 6B 00 00' nel datasheet) o Mode 21 (Toyota), inviate a un'ECU specifica impostando l'header (es. ATSH 7E0 per motore su CAN 11 bit, altre ECU a indirizzi di marca) e decodificate con una formula sui byte A,B,C.... Il datasheet ELM327 precisa che Elm Electronics non mantiene liste dei PID proprietari.
- Car Scanner: oltre ai PID standard offre un database di profili per marca/modello sviluppato dallo sviluppatore (centinaia di marche; EV: salute batteria, pressione gomme, odometro, ABS...), con rilasci frequenti; permette sensori personalizzati (comando = mode+PID, header ECU, formula con byte A,B,C..., funzioni come FLOAT32/if, unita' scelta dall'utente; l'importazione e' nel proprio formato). Nessun segnale di profili comunitari nel changelog.
- Torque Pro: PID estesi in CSV (campi nome, nome breve, ModeAndPID, equazione, ecc.) condivisi da comunita' (Prius, F-150 Lightning...), senza licenza chiara.
- OBD Fusion: PID estesi per alcuni produttori (es. GM integrati) e pacchetti 'enhanced diagnostics' acquistabili in-app per marca (anche DTC su ABS/SRS e centinaia di PID extra).
- Carly: adattatore proprietario 'bloccato' + database proprietario per marca (BMW, Mercedes, gruppo VAG ecc.) con abbonamenti annuali (fino a circa 64 USD secondo fonti di recensione).
LICENZA/LEGALE: (1) le formule dei PID SAE standard sono fatti pubblicati (anche su Wikipedia, CC BY-SA 4.0: non copiare tabelle verbatim, ricavare e riscrivere; lo standard J1979 e' a pagamento); (2) i PID proprietari sono documentati solo da licenze OEM o ETI con costi da circa 1.000 a 50.000 USD l'anno (Wikipedia); (3) i database commerciali (Carly, Car Scanner profili, add-on OBD Fusion) sono proprietari: vietato estrarli/copiarli; i CSV di comunita' non hanno licenza chiara: non incorporarli senza permesso scritto; (4) in UE il Regolamento 2018/858 impone ai costruttori accesso a informazioni OBD e RMI per operatori indipendenti, ma tramite portali OEM (a pagamento, non un dump gratuito); (5) il Regolamento delegato UE 2026/699 (in vigore dal 2026-06-23, scadenze scaglionate fino a giugno 2028) consente ai costruttori misure di sicurezza e autenticazione degli strumenti diagnostici.
RACCOMANDAZIONE: costruire un registro PID proprio (formato dati: id, ecu header, request, bytes, formula, unita', veicoli verificati, fonte, data) popolato solo da PID verificati su auto reali di proprieta' (con log registrati) e da fonti con licenza compatibile; segnare ogni voce con 'verified_on' e 'confidence'; permettere profili utente come in Car Scanner.

Fonti:
- https://www.carscanner.info/custompids/
- https://www.carscanner.info/profile-database-changelog/
- https://www.priuschat.com/goto/post?id=1491933
- https://apps.apple.com/ar/app/id650684932
- https://iamcarhacker.com/?p=42510
- https://www.businesswire.com/news/home/20200212005157/en/CarTech-Company-Carly-Launches-Universal-Onboard-Diagnostic
- https://en.wikipedia.org/wiki/OBD-II_PIDs
- https://www.noerr.com/en/insights/delegated-regulation-eu-2026-699-sets-out-new-guidelines-for-secure-gateways-obd-access-and-rmi
- https://www.elmelectronics.com/wp-content/uploads/2016/07/ELM327DS.pdf

### 19. Dati DERIVABILI da OBD standard + input utente: stima km, scadenze tagliando, avvisi temperatura, trend batteria, consumo  `[confidenza: medium]`

1) KM STIMATI: (a) integrare la velocita' 010D nel tempo (campionamento 1-4 Hz, errore tipico ~1-3%: metodo mio, confidence media) accumulando per sessione; (b) delta del contatore 0131 tra due sessioni (km dalla cancellazione DTC) se supportato e non decresciuto (reset = cancellazione DTC o scollegamento: rilevare e riancorare); (c) distanza totale OBFCM (Mode 09 0917, pista da verificare) sulle auto UE 2021+; (d) offset: sempre riancorare al km reale inserito dall'utente (foto/inserimento al tagliando). Mostrare 'km stimati' con etichetta distinta da 'km letti'.
2) TAGLIANDO/OLIO: scadenza = min(km dall'ultimo intervento >= soglia, mesi >= soglia, ore motore). Ore motore: sommare 011F (tempo dall'avviamento) per sessione. Indicatori di uso severo: numero di viaggi brevi (<10 min), assenza di temperatura olio/refrigerante a regime (es. refrigerante mai oltre 80 C) -> suggerire intervalli ridotti. Qualsiasi 'olio X%' e' una stima del tuo modello, non un valore ECU.
3) AVVISO TEMPERATURA OLIO: solo se 015C e' dichiarato e risponde (altrimenti proxy con refrigerante 0105, dichiarando il limite); soglie configurabili.
4) BATTERIA 12V (euristica, non SoH): ATRV a motore spento (tensione a riposo: sotto ~12.4 V = carica bassa), minimo durante lo spunto (campionamento limitato dalla latenza BLE, ~200-300 ms), tensione di ricarica a motore acceso (circa 13.8-14.7 V = alternatore OK; 0142 vs ATRV per vedere cali di cablaggio); salvare trend per veicolo. Valori soglia: da ingegneria automotive generale, confidence bassa: etichettare 'indicativo'.
5) CONSUMI: da 015E (L/h) / velocita' = L/h / (km/h) * 100 L/100km; oppure da MAF 0110 per benzina: L/h = MAF(g/s)*3600 / (14.7 * 745) (rapporto stechiometrico 14.7, densita' ~745 g/L; es. 10 g/s -> 3.29 L/h); sui diesel il MAF non da' il carburante (miscela magra): usare 015E o OBFCM; i dati di rifornimento inseriti dall'utente restano il riferimento.
6) SCADENZE: assicurazione, bollo, revisione (biennale dopo la prima a 4 anni: normativa italiana da verificare), tagliandi: motore di promemoria locale (notifiche), tutto inseribile senza adattatore.

Fonti:
- https://en.wikipedia.org/wiki/OBD-II_PIDs
- https://github.com/Anush-aj/obfcm
- https://www.elmelectronics.com/wp-content/uploads/2016/07/ELM327DS.pdf

### 20. Veicoli europei: EOBD, protocolli (CAN 11/29 bit, K-line, ISO 9141, J1850), connettore e indirizzi  `[confidenza: medium]`

EOBD obbligatorio nell'UE dal 2001-01-01 per i benzina e dal 2004-01-01 per i diesel (i nuovi modelli un anno prima: 2000 benzina, 2003 diesel). PID 011C = 6 per EOBD puro, 7 per EOBD+OBD-II (Wikipedia). 'EOBD2' e' un termine di marketing, non standard.
PROTOCOLLI (numeri ELM): 1 J1850 PWM (Ford USA), 2 J1850 VPW (GM USA): rari in Europa; 3 ISO 9141-2 e 4/5 ISO 14230-4 KWP2000 (K-line, 10.4 kbit/s, usati da molte auto europee/asiatiche pre-CAN; init lento a 5 baud 2-3 s oppure init veloce); 6/8 ISO 15765-4 CAN 11 bit 500/250 kbit/s; 7/9 CAN 29 bit 500/250. La CAN e' obbligatoria negli USA dal 2008; per l'UE il datasheet/Wikipedia non specificano la data (la maggior parte delle auto UE dal ~2006-2008 e' su CAN: confidence bassa). Pre-2001/2004 spesso K-line: l'app deve gestire BUS INIT lento (timeout 8 s) e wake-up automatico ogni 3 s.
CAN: richieste funzionali a 7DF (11 bit) o 18 DB 33 F1 (29 bit); fisiche 7E0-7E7 / 18 DA <ECU> F1; risposte 7E8-7EF / 18 DA F1 <ECU>; fino a 8 ECU. Il datasheet mostra ATSH 7DF per le funzionali e che, vista la risposta 7E8, si puo' parlare solo con quell'ECU con ATSH 7E0; ATCRA 7E8 filtra le risposte. Frame CAN a 8 byte con padding; il PCI indica la lunghezza utile.
CONNETTORE OBD (J1962): pin 16 = +12 V batteria (spesso sempre alimentato anche a quadro spento), pin 4/5 massa, pin 6/14 CAN, pin 7 K-line, pin 2/10 J1850: consente ATRV a quadro spento e spiega il consumo dell'adattatore sempre inserito.
[CORRETTO dalla verifica: non e' un fatto 'Unione EU' ma una procedura ITALIANA (DD 11-08-2023, circolare MIT 33287 del 07-11-2023; centri attrezzati dal 2024-02-24)]: la revisione italiana usa lo scantool OBD per i veicoli M1/M2/N1 Euro 5/6 immatricolati dal 2009-09-01.

Fonti:
- https://en.wikipedia.org/wiki/On-board_diagnostics
- https://www.elmelectronics.com/wp-content/uploads/2016/07/ELM327DS.pdf
- https://en.wikipedia.org/wiki/OBD-II_PIDs
- https://engineerfix.com/how-iso-15765-4-uses-the-can-11-bit-identifier/

### 21. Auto elettriche/ibride e rischio futuro: OBDonUDS (SAE J1979-2/-3), Euro 7 e regolamento 2026/699  `[confidenza: medium]`

EV/IBRIDE OGGI: non esiste uno standard concordato per i PID della batteria dei BEV; Wikipedia elenca il PID 5B (vita residua batteria ibrida, A*100/255 %, opzionale) e il PID 9A (dati sistema ibrido/EV, 6 byte, poco documentato). Un BEV puo' rispondere a pochi PID Mode 01 (es. velocita' 010D) e VIN; SoC, SoH, celle, temperature dipendono da Mode 22/UDS di marca (Prius via Mode 22 Toyota; Nissan Leaf SoH; Hyundai Ioniq con serie 2101-2104). Car Scanner copre molte EV con profili proprietari. Promessa onesta: 'per le elettriche leggiamo solo i dati standard disponibili; i dati batteria arrivano con profili di marca quando presenti'.
OBDonUDS: SAE J1979-2 (UDS ISO 14229 per i veicoli con motore a combustione) e J1979-3 (ZEV) sostituiscono l'OBD classico; CARB: obbligatorio dal modello 2027 (alcuni Volvo/Mack gia' dal 2024); gli identificatori (DID) cambiano, es. 0xF4B2 per lo stato di salute batteria di propulsione ZEV. I veicoli J1979-2 non rispondono ai protocolli classici: un ELM327 che invia solo '01 00' non funziona. Un ELM327 puo' comunque inviare '22 F4xx' grezzi, ma serve un livello di servizio UDS nell'app (ISO-TP gia' previsto). Per l'UE: Euro 7 (Reg. UE 2024/1257) con applicazione scaglionata dal novembre 2026 per i nuovi tipi e dal novembre 2027 per tutte le nuove immatricolazioni (date da una sintesi secondaria: confidence bassa) [CONFERMATO dalla verifica: Parlamento europeo/OEIL https://oeil.europarl.europa.eu/oeil/en/document-summary?id=1784743 riporta applicazione dal 2026-11-29 per i nuovi tipi di auto e furgoni e dal 2027-11-29 per i nuovi veicoli (bus/camion: 2028-05-29 e 2029-05-29); confidenza ora alta sulle date. Resta [DA VERIFICARE] se l'UE imponga OBDonUDS: ne' la sintesi OEIL ne' la nota Noerr sul Reg. 2026/699 lo menzionano.]; NON ho verificato in fonte primaria che l'UE imponga OBDonUDS come negli USA.
AUTENTICAZIONE: Regolamento delegato UE 2026/699 (in vigore dal 2026-06-23, scadenze fino a giugno 2028) consente ai costruttori di richiedere autenticazione per strumenti diagnostici (certificati/token) in modo 'necessario e proporzionato': i lettori generici potrebbero incontrare barriere, soprattutto sulle funzioni oltre l'OBD emissioni (confidence media; non chiaro l'impatto sul Mode 01/03 generico).
IMPLICAZIONE: pianificare architettura con livello 'DiagnosticService' astratto (J1979 / UDS), non solo PID Mode 01.

Fonti:
- https://en.wikipedia.org/wiki/OBD-II_PIDs
- https://ww2.arb.ca.gov/sae-j1979-2-guidance
- https://kvaser.com/the-future-of-on-board-diagnostics-obd-on-uds-and-zev-on-uds/
- https://obdai.app/new-cars-scan-tools-cannot-test-j1979-2-obdonuds/
- https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:32024R1257
- https://www.noerr.com/en/insights/delegated-regulation-eu-2026-699-sets-out-new-guidelines-for-secure-gateways-obd-access-and-rmi
- https://obdllm.com/en/blog/ev-hybrid-obd-diagnostics-tesla-nissan-leaf/

### 22. Android: permessi Bluetooth, flag neverForLocation, foreground service, target SDK e Play Store  `[confidenza: high]`

MANIFEST per targetSdk >= 31 (Android 12+; doc Android):
<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" android:maxSdkVersion="30" />
BLUETOOTH_SCAN e BLUETOOTH_CONNECT sono permessi runtime ('Dispositivi nelle vicinanze'): chiedere BLUETOOTH_SCAN per cercare e BLUETOOTH_CONNECT per comunicare con dispositivi gia' accoppiati. neverForLocation: da dichiarare solo se non si deriva la posizione dalle scansioni; effetto collaterale: alcuni beacon BLE vengono filtrati (irrilevante per OBD). Su Android <= 11 la scansione richiede ACCESS_FINE_LOCATION a runtime (e il toggle Posizione di sistema attivo: comportamento noto, confidence media). Se l'app in futuro usa il GPS per i viaggi, la posizione va richiesta e dichiarata a parte.
Expo/ble-plx: il config plugin 'react-native-ble-plx' aggiunge BLUETOOTH_SCAN/CONNECT (>=12) e BLUETOOTH/BLUETOOTH_ADMIN (<12), con opzioni isBackgroundEnabled, modes (['central']), bluetoothAlwaysPermission e neverForLocation.
BACKGROUND: da Android 14 un servizio in primo piano che usa Bluetooth deve dichiarare android:foregroundServiceType="connectedDevice" + permessi FOREGROUND_SERVICE e FOREGROUND_SERVICE_CONNECTED_DEVICE e, a runtime, almeno un permesso come BLUETOOTH_CONNECT. Consiglio: NON tenere connessione in background; sessioni on-demand. Se in futuro 'registrazione viaggio', usare un foreground service con notifica persistente e dichiarazione in Play Console.
PLAY STORE: requisito target API: dal 2026-08-31 le nuove app e gli aggiornamenti devono avere targetSdk 36 (Android 16) o superiore (estensione richiedibile fino al 2026-11-01); le app esistenti almeno API 35. Verificare che Expo SDK 57 imposti targetSdk 36 (expo-build-properties). Data safety: i dati trattati solo sul dispositivo non vanno dichiarati; se si sincronizza in cloud VIN/storico DTC/posizione, e' 'collected' e va dichiarato (incluse librerie/SDK terze). Dichiarare <uses-feature android:name="android.hardware.bluetooth_le" android:required="false"/> per non escludere dispositivi (buona pratica, confidence media).

Fonti:
- https://developer.android.com/develop/connectivity/bluetooth/bt-permissions
- https://developer.android.com/develop/background-work/services/fgs/service-types
- https://developer.android.com/google/play/requirements/target-sdk
- https://support.google.com/googleplay/android-developer/answer/10787469
- https://github.com/dotintent/react-native-ble-plx

### 23. iOS: Info.plist, background, Rete locale, MFi, AccessorySetupKit e requisiti di App Review per accessori hardware  `[confidenza: medium]`

INFO.PLIST: NSBluetoothAlwaysUsageDescription (obbligatoria da iOS 13 per qualunque uso di Core Bluetooth; NSBluetoothPeripheralUsageDescription e' il predecessore deprecato): testo in italiano e specifico, es. 'Serve per collegarti all'adattatore OBD e leggere i dati dell'auto'. Con ble-plx/Expo: opzione bluetoothAlwaysPermission del config plugin. BACKGROUND: UIBackgroundModes = bluetooth-central consente di scoprire/connettersi/ricevere notifiche in background; con state restoration (CBCentralManagerOptionRestoreIdentifierKey, willRestoreState; in ble-plx restoreStateIdentifier/restoreStateFunction). In background la scansione perde AllowDuplicates e rallenta. Per un'app di manutenzione consiglio di NON dichiarare background mode (meno review, meno batteria auto) e usare sessioni in primo piano. WIFI: NSLocalNetworkUsageDescription per TCP verso 192.168.x.x (iOS 14+). MFi: per accessori Classic servono External Accessory, UISupportedExternalAccessoryProtocols e programma MFi: saltare. ACCESSORYSETUPKIT (iOS 18+): picker di sistema che sostituisce il permesso Bluetooth generico, con Info.plist NSAccessorySetupKitSupports/NSAccessorySetupBluetoothServices/NSAccessorySetupBluetoothNames (+ NSAccessorySetupBluetoothCompanyIdentifiers) [CORRETTO dalla verifica: la chiave si chiama NSAccessorySetupKitSupports, non NSAccessorySetupSupports; i valori devono essere dichiarati nel plist altrimenti l'app viene terminata a showPicker; con AccessorySetupKit NSBluetoothAlwaysUsageDescription NON va dichiarata; fonte https://punchthrough.com/ios18-accessorysetupkit-everything-ble-developers-need-to-know/]; con servizi/nomi generici degli adattatori e' poco pratico: opzione futura.
APP REVIEW (Guideline 2.1): per app che richiedono hardware esterno Apple chiede un video demo su dispositivo fisico (pairing e flusso completo) nelle App Review Information, spesso anche una modalita' demo: il simulatore in-app (MockTransport, vedi finding) e' cosi' un requisito di pubblicazione oltre che di sviluppo. Altri: privacy nutrition label (dichiarare cosa lascia il dispositivo), account Apple Developer a pagamento per build device.
Build: Expo Go NON puo' usare moduli BLE nativi; serve development build con expo-dev-client via EAS (eas build --profile development); iOS richiede account Apple Developer a pagamento per device (il PC Windows non puo' compilare iOS).

Fonti:
- https://developer.apple.com/documentation/bundleresources/information-property-list/nsbluetoothalwaysusagedescription
- https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/CoreBluetoothBackgroundProcessingForIOSApps/PerformingTasksWhileYourAppIsInTheBackground.html
- https://developer.apple.com/documentation/bundleresources/information-property-list/nslocalnetworkusagedescription
- https://developer.apple.com/documentation/externalaccessory
- https://punchthrough.com/ios18-accessorysetupkit-everything-ble-developers-need-to-know/
- https://developer.apple.com/forums/thread/100426
- https://docs.expo.dev/develop/development-builds/introduction/
- https://github.com/dotintent/react-native-ble-plx

### 24. Consumo della batteria dell'auto con adattatore sempre inserito: cifre e mitigazioni  `[confidenza: medium]`

Il pin 16 del connettore e' di norma alimentato anche a quadro spento, quindi un adattatore inserito assorbe corrente continuamente se non va in sleep. Dati: OBDLink CX 55 mA in funzione e < 1 mA in 'BatterySaver Low Power Mode' (pagina prodotto; altre fonti riportano < 2 mA). Manuale OBDLink (FRPM, rev. E 2025): MX, LX, MX+, CX, Carbyte vanno in sleep dopo 600 s di inattivita' UART e si risvegliano su connessione Bluetooth o variazione di tensione (0,20 V in 1000 ms; MX+ anche su attivita' OBD); STSLEEP lo forza. Veepeak indica massimo 45 mA di corrente di funzionamento e dichiara l'adattatore sicuro da lasciare inserito (fonte secondaria). I cloni economici senza sleep assorbono tipicamente 20-60 mA (blog, confidence bassa); come ordine di grandezza una batteria sana sopporta ~50 mA per settimane prima di non avviare (blog). ELM327 originali hanno ATLP (low power) ma i cloni v1.4-based non gestiscono le funzioni v2.0 (risveglio con impostazioni mantenute).
MITIGAZIONI IN APP: (1) sessioni on-demand: connetti, leggi, disconnetti; (2) mai polling continuo quando il motore e' spento o l'app e' in background (anche il polling tiene sveglio l'adattatore e resetta il timer di inattivita' UART); (3) pulsante 'Metti in sleep' (STSLEEP su STN, ATLP su ELM) e disconnessione esplicita al termine; (4) letture ATRV: se < 12.0 V a motore spento, avvisare di scollegare l'adattatore; (5) avviso informativo in scheda adattatore: 'se l'auto resta ferma piu' di 2 settimane, scollega l'adattatore'; (6) niente servizio foreground persistente per default; (7) misurare con multimetro in serie l'assorbimento dell'adattatore effettivo e documentarlo (log della sessione di test).

Fonti:
- https://www.obdlink.com/products/obdlink-cx/
- https://www.scantool.net/scantool/downloads/678/obdlink_frpm_e.pdf
- https://iamcarhacker.com/does-obd-bluetooth-drain-the-battery/
- https://en.wikipedia.org/wiki/On-board_diagnostics

### 25. Scelta stack e librerie: Expo SDK 57/RN 0.86 (solo New Architecture) e stato reale delle librerie BLE/Classic/TCP (npm, 2026-10-06)  `[confidenza: medium]`

PIATTAFORMA: Expo SDK 57 (RN 0.86, React 19.2, release 'piccola' senza breaking changes rispetto alla 56; Node >= 22.13: il tuo Node 24 va bene); da SDK 55 la New Architecture e' sempre attiva e non disattivabile (la legacy solo fino a SDK 54). Expo non ha una libreria Bluetooth ufficiale. Expo Go non basta: dev build con expo-dev-client (v57.0.19) via EAS. Piano EAS Free: 15 build Android + 15 iOS al mese, coda a bassa priorita' (Starter 19 USD/mese). Il PC Windows e l'emulatore Android non hanno BLE reale: per la UI usare Expo web/Jest con MockTransport.
LIBRERIE (versioni npm verificate): 
- react-native-ble-manager 12.5.3 (Apache-2.0; release 12.5.3 il 2026-09-21; cadenza regolare 2025-2026; richiede RN 0.76+ e SOLO New Architecture; iOS 15.1+, Android API 23+; supporta Expo con prebuild). Candidata principale per SDK 57.
- react-native-ble-plx 3.5.1 (licenza: npm MIT, file LICENSE Apache-2.0 con Polidea/intent: verificare; ultima release 2026-02-18, prima 3.5.0 2025-02-11; modulo legacy; issue aperte #1277 'RN New Architecture Compatibility' e #1278 crash iOS release; PR draft #1331 'V4 turbomodule rewrite' aggiornata a 2026-09). Rischio medio con New Architecture obbligatoria: fare uno spike su telefono reale. Pro: API a Observable/Promise, mock react-native-ble-plx-mock 1.3.2 (MIT). Limiti: niente Classic, no Expo Go.
- react-native-bluetooth-classic 1.73.0-rc.17 (MIT; ultima release 2025-11-19; solo tag 'latest' rc; peer RN >= 0.73.1; Android RFCOMM, iOS External Accessory/MFi): usare solo su Android; compatibilita' New Architecture non verificata (confidence bassa).
- react-native-tcp-socket 6.4.3 (MIT, 2026-09-10) per WiFi.
- react-native-bluetooth-obd-manager 1.0.4 (MIT, wrapper BLE su ble-plx con KNOWN_ELM327_TARGETS): solo come riferimento.
DATI: expo-sqlite 57.0.4 (MIT) per veicoli/interventi/scadenze offline-first; test: jest 30.5.2 o vitest 5.0.3 (MIT).
DECISIONE: definire subito l'interfaccia Transport e fare uno spike di 1-2 giorni 'connect + ATZ + 010C' con ble-manager su Android reale prima di scrivere il resto; ble-plx come piano B.

Fonti:
- https://www.npmjs.com/package/react-native-ble-manager
- https://innoveit.github.io/react-native-ble-manager/
- https://github.com/innoveit/react-native-ble-manager
- https://www.npmjs.com/package/react-native-ble-plx
- https://github.com/dotintent/react-native-ble-plx/issues?q=new+architecture
- https://raw.githubusercontent.com/dotintent/react-native-ble-plx/master/LICENSE
- https://www.npmjs.com/package/react-native-bluetooth-classic
- https://github.com/kenjdavidson/react-native-bluetooth-classic
- https://www.npmjs.com/package/react-native-tcp-socket
- https://expo.dev/changelog/sdk-57
- https://docs.expo.dev/versions/latest/
- https://docs.expo.dev/guides/new-architecture.md
- https://expo.dev/pricing
- https://docs.expo.dev/develop/development-builds/introduction/

### 26. Architettura consigliata del client OBD in TypeScript: Transport, coda comandi, parser puri, init, registro PID e test su trascrizioni  `[confidenza: high]`

STRATI (dal basso): 1) Transport (interfaccia): connect(device), write(text), onData(cb(bytes|string)), onDisconnect, close, capabilities {mtu, writeType}. Implementazioni: BleTransport (ble-manager/ble-plx con selezione UUID e bufferizzazione), ClassicTransport (Android), TcpTransport (WiFi), MockTransport (simulatore). 2) ElmSession: coda FIFO a priorita' (un comando in volo), accumula byte fino a '>', normalizza (rimuove NUL, eco, 'SEARCHING...'), restituisce {raw, lines, error?}; timeout/retry per tipo comando; gestione '?' e stringhe di errore; log grezzo con timestamp (direzione, byte) per registrare trascrizioni. 3) AdapterInit: sequenza ATZ/ATE0/ATL0/ATS0/ATH1/ATSP0/0100/ATDPN con sonda capacita' (ATAMC, STI) e cache protocollo. 4) Parser PURI (nessuna I/O): parseFrames(lines, protocol) -> {ecu, bytes}[] (ATH1 e ATH0), isoTpReassemble, decodePidSupport, decodeStatus0101, decodePid(pid, bytes) con tabella dichiarativa, decodeDtcList(bytes, canFormat), decodeVin, decodeFreezeFrame. 5) VehicleService: casi d'uso (readSnapshot: VIN+0101+DTC+PID chiave; liveStream(pids); clearDtc con conferma). 6) Dominio/storage (SQLite): veicoli, interventi (tagliandi, olio), assicurazioni/scadenze, letture storiche, adapter profile.
SKETCH:
interface Transport { connect(id:string):Promise<void>; write(s:string):Promise<void>; onData(cb:(chunk:string)=>void):()=>void; onClose(cb:()=>void):()=>void; close():Promise<void>; }
interface ElmResponse { raw:string; lines:string[]; status:'ok'|'no_data'|'unable'|'error'|'timeout'; }
class ElmSession { send(cmd:string,opts?:{timeoutMs:number;priority?:number}):Promise<ElmResponse> }
TEST: file di trascrizioni '.txt'/JSON {cmd, rx[] (chunk BLE reali), expected} registrati dal log grezzo di auto reali (OBDLink, clone v1.5, K-line, J1850 se disponibili) + trascrizioni sintetiche degli esempi sopra (VIN CAN ATH0/ATH1, J1850, DTC 1/3 codici, 0100 multi-ECU, NO DATA, UNABLE TO CONNECT, STOPPED). Golden test per parser (jest/vitest, nessun mock di BLE) + property test sul riassemblaggio ISO-TP (ordine frame casuale tra ECU). Il parser non deve mai lanciare eccezioni su input sporco: restituisce Result/errore tipizzato (fuzz con dati casuali). Replay: MockTransport legge una trascrizione e ripropone chunk BLE spezzati a 20 byte per testare il buffering.

Fonti:
- https://raw.githubusercontent.com/brendan-w/python-OBD/master/obd/elm327.py
- https://github.com/zsirafmix/elm327
- https://github.com/kkonteh97/SwiftOBD2
- https://github.com/edu-amr/elm327
- https://www.elmelectronics.com/wp-content/uploads/2016/07/ELM327DS.pdf

### 27. Strategia di simulazione per sviluppare senza auto (PC Windows senza Android SDK): simulatore in-app in TS + strumenti esterni e loro licenze  `[confidenza: high]`

1) SIMULATORE IN-APP (consigliato, primario): MockTransport che implementa una macchina a stati ELM327: stato {echo, linefeed, spaces, headers, protocol, adaptive timing}; risponde a ATZ ('ELM327 v2.1'), ATE0/L0/S0/H1 ('OK'), ATSP0 + 0100 ('SEARCHING...' ritardo 1.5 s poi risposta), ATDPN ('A6'), ATRV, 0100/0120/..., 010C/010D/0105 dinamici, 0101, 0902 multi-frame, 03/07/0A, 04 (azzera lo stato), 02, e scenari: veicolo benzina CAN 11 bit, diesel, K-line lenta, 'cloni' difettosi (v1.5 che risponde '?' ad ATAMC/ATCRA), errori (NO DATA, UNABLE TO CONNECT, STOPPED, BUFFER FULL), spezzatura a 20 byte, ritardi variabili, disconnessione. Gira in Jest/vitest, in Expo web sul PC e nella dev build come 'Modalita' demo' (utile anche per App Review). Riferimento: SwiftOBD2 (MIT) ha un emulatore integrato.
2) ELM327-emulator (Python, Ircama): emula ECU multiple, ISO-TP, UDS, scenari 'car' (Toyota Auris Hybrid), TCP (python3 -m elm -s car -n 35000; Windows: porta TCP o COM virtuale con com0com), Python 3.6-3.14. ATTENZIONE LICENZA: CC BY-NC-SA 4.0 (non commerciale, share-alike): usarlo solo come strumento esterno di sviluppo e non incorporarlo ne' ridistribuirlo nel prodotto. Per collegare un telefono reale serve un trasporto TCP (react-native-tcp-socket) verso il PC sulla stessa rete.
3) 'ELM327 Emulator' Android (F-Droid com.github.autodiag2.elm327emu, GPL-3.0-only, v29 del 2026-08-04): simula un adattatore via Bluetooth, BLE e rete su un secondo telefono: utile per provare il vero BleTransport/ClassicTransport senza auto. Uso solo come strumento di test (GPL: niente incorporazione).
4) elm327emu (poropi): emulatore con 2 ECU, BLE (FFE0/FFE1, alt FFF0/FFF1/FFF2) + SPP su Android, BLE/TCP su macOS, modi 01,02,03,04,06,07,09,0A,22, CAN 11/29 bit; licenza non verificata.
5) Registrazione di sessioni reali (log raw) per costruire fixture 'golden' da ogni auto di prova.
NOTA: nessun simulatore sostituisce il test su hardware: prevedere checklist su almeno 1 clone economico, 1 OBDLink/vLinker e 1 K-line (se disponibile).

Fonti:
- https://github.com/Ircama/ELM327-emulator
- https://raw.githubusercontent.com/Ircama/ELM327-emulator/master/LICENSE
- https://f-droid.org/packages/com.github.autodiag2.elm327emu/
- https://github.com/poropi/elm327emu
- https://github.com/kkonteh97/SwiftOBD2
- https://www.npmjs.com/package/react-native-tcp-socket

### 28. Librerie open source da cui prendere spunto, con licenza e cosa e' lecito fare  `[confidenza: high]`

- python-OBD (brendan-w): GPL-2.0; ~635 commit, 86 issue aperte; riferimento per sequenza init (ATZ,ATE0,ATH1,ATL0,ATRV, ATSP0, 0100, ATDPN; ordine di ripiego protocolli 6,8,1,7,9,2,3,4,5,A), parser CAN (SF/FF/CF), decoder. Con GPL-2.0 NON copiare codice in un'app chiusa: leggere per idee e riscrivere clean-room, oppure rilasciare l'app come GPL.
- ELM327-emulator (Ircama): CC BY-NC-SA 4.0 (non commerciale).
- elm327 su npm (edu-amr): MIT, TypeScript, trasporti seriale/WiFi/BLE web, modalita' compatibilita' per cloni, 23+ PID: utile per struttura TS.
- react-native-bluetooth-obd-manager: MIT; zsirafmix/elm327 (Kotlin): MIT, init 'ATZ 8s -> ATE0/ATL0/ATS0/ATH0/ATSP0 -> 0100 -> ATDP', hint matrix UUID; SwiftOBD2: MIT, Swift con emulatore integrato; Flutter-OBD2 (AceBurgundy): MPL-2.0, discovery greedy di tutte le caratteristiche notify; android-obd-reader (pires): Apache-2.0 ma archiviato dal 2017-11-10 (usa obd-java-api); obd-utils npm: Apache-2.0; obd-parser npm: GPL-3.0 (evitare); obfcm (Anush-aj): MIT (pista OBFCM).
- Dati: contenuti Wikipedia (CC BY-SA 4.0); SAE J1979/J2012 a pagamento ma le formule sono fatti; DTC: dtc-lookup (MIT).
Regola pratica: MIT/Apache/MPL = riutilizzabili con attribuzione (MPL: i file modificati restano aperti); GPL/AGPL e CC-NC = solo ispirazione o strumenti di test esterni. Tenere un file THIRD_PARTY_LICENSES.

Fonti:
- https://github.com/brendan-w/python-OBD
- https://github.com/Ircama/ELM327-emulator
- https://raw.githubusercontent.com/Ircama/ELM327-emulator/master/LICENSE
- https://github.com/edu-amr/elm327
- https://unpkg.com/react-native-bluetooth-obd-manager@1.0.4/README.md
- https://github.com/zsirafmix/elm327
- https://github.com/kkonteh97/SwiftOBD2
- https://github.com/AceBurgundy/Flutter-OBD2
- https://github.com/pires/android-obd-reader
- https://github.com/Anush-aj/obfcm
- https://github.com/Gershel13/dtc-lookup [DA VERIFICARE: grafia dell'owner incoerente con il finding 15 ('Gershy13'); una delle due e' probabilmente errata, licenza MIT non riverificata]

### 29. Privacy e quadro normativo UE/Italia da considerare: VIN come dato personale, Data Act, accesso OBD, revisione  `[confidenza: medium]`

- VIN e GDPR: la CGUE (causa C-319/22, sentenza 9 novembre 2023, Gesamtverband Autoteile-Handel c. Scania) ha stabilito che il VIN non e' di per se' un dato personale ma lo diventa per chi ha mezzi ragionevoli per associarlo a una persona. Un'app che salva VIN + account utente tratta dati personali: informativa privacy, base giuridica, minimizzazione, cifratura a riposo, cancellazione su richiesta, nessun invio a terzi senza consenso; il database locale-first riduce gli obblighi (e le dichiarazioni Data safety/privacy label).
- Reg. UE 2018/858 art. 61 e Allegato X: accesso senza restrizioni, standardizzato e non discriminatorio alle informazioni OBD e RMI per gli operatori indipendenti (via OEM); Reg. delegato UE 2026/699 permette autenticazione degli strumenti (vedi finding EV/OBDonUDS).
- Data Act UE (applicabile dal 2025-09-12): l'utente di un prodotto connesso (auto incluse) ha diritto di accedere ai dati generati, ma tramite il costruttore e non sono compresi i dati derivati; non sostituisce la lettura OBD.
- Revisione Italia: vedi finding Mode 04 (MIL, scantool dal 2024-02-24, OBFCM con opposizione del proprietario).
- Responsabilita': disclaimer sull'uso di funzioni di scrittura (Mode 04); l'app non deve suggerire di guidare con spie rosse; nessuna funzione di coding/regolazione ECU nella v1.
(Per la parte legale consigliato parere di un legale prima del rilascio: queste sono sintesi da fonti secondarie.)

Fonti:
- https://www.matheson.com/insights/cjeu-considers-whether-vehicle-identification-numbers-constitute-personal-data
- https://prighter.com/resources/cjeu-ruling-gdpr-scope-vehicle-data-identifiability
- https://www.noerr.com/en/insights/delegated-regulation-eu-2026-699-sets-out-new-guidelines-for-secure-gateways-obd-access-and-rmi
- https://www.mayerbrown.com/en/insights/publications/2025/11/the-eu-data-act-has-taken-effect-focus-on-automotive-and-cloud-providers
- https://revisione.dekra.it/sites/default/files/Il%20nuovo%20controllo%20Scantool%20OBD.pdf

## Raccomandazioni

- Fissare l'MVP su: BLE come trasporto principale (iOS+Android), WiFi/TCP secondario, Classic SPP solo Android in fase 2; supportare qualunque ELM327-compatibile con sonda di capacita' e banner qualita' adattatore; consigliare in-app 1-2 modelli BLE (OBDLink CX, Vgate iCar Pro 2S / vLinker MC+).
- Spike tecnico di 1-2 giorni su telefono Android reale con react-native-ble-manager 12.5.3 (e in parallelo ble-plx 3.5.1) su Expo SDK 57 dev build via EAS: connect, selezione UUID da lista nota, ATZ, ATH1, 010C. Decidere la libreria in base all'esito; mantenere l'interfaccia Transport per poter cambiare.
- Implementare per prima cosa i parser puri + ElmSession + MockTransport con trascrizioni (ATH0 e ATH1) e test golden; registrare log grezzi di ogni sessione reale come fixture. Usare ATH1 con ISO-TP proprio, ATS0, ATE0, un comando alla volta, '>' come terminatore, bufferizzazione dei chunk BLE.
- Fare una 'sessione snapshot' on-demand come funzione cardine (VIN, 0101, 03/07/0A, freeze frame, PID chiave, ATRV) e salvare per veicolo il profilo di capacita' (PID dichiarati e realmente rispondenti); costruire la UI su cio' che risponde, con etichette 'letto / stimato / inserito'.
- Non promettere livello olio, vita olio, intervallo service, TPMS, usura pastiglie, SoH batteria 12V, SoC/SoH EV, odometro generico: offrire inserimento manuale + stime derivate (km da 0131/velocita', ore motore da 011F, scadenze per km/tempo, trend tensione ATRV/0142). Valutare profili di marca solo come fase successiva con registro PID proprio verificato su auto reali.
- Trattare Mode 04 come azione protetta: backup automatico di DTC+freeze frame+stato 0101 prima, doppia conferma con elenco degli effetti (DTC, freeze frame, dati test, monitor di prontezza; permanenti non cancellati), blocco a motore acceso, mai promuoverla per la revisione (in Italia, con i centri attrezzati dal 2024-02-24, conta il MIL letto via scantool; vedi correzione al finding 16).
- Permessi minimi: Android BLUETOOTH_SCAN con neverForLocation + BLUETOOTH_CONNECT, legacy con maxSdkVersion 30 e posizione solo <= 11; iOS solo NSBluetoothAlwaysUsageDescription (+ NSLocalNetworkUsageDescription se WiFi); niente background mode e niente foreground service nella v1 per ridurre review e consumo batteria.
- Licenze: usare codice da MIT/Apache/MPL; python-OBD (GPL-2.0), ELM327-emulator (CC BY-NC-SA 4.0) e l'app emulatore Android (GPL-3.0) solo come riferimento/strumenti di test, non incorporati; non copiare tabelle Wikipedia (CC BY-SA); mantenere THIRD_PARTY_LICENSES.
- Preparare per App Review una Modalita' demo basata sul simulatore e un video con hardware reale; verificare targetSdk 36 su Expo SDK 57 per il Play Store (scadenza 2026-08-31, estensione al 2026-11-01).
- Misurare in pratica: assorbimento a riposo degli adattatori di test (multimetro), tempi di ATZ/ricerca protocollo, throughput BLE per adattatore, quali PID rispondono sulle auto di prova (obbligatorio per validare 012F, 015C, 01A6, Mode 09 0917).

## Rischi

- Compatibilita' con la New Architecture: Expo SDK 55+ e' solo New Arch; ble-plx e' un modulo legacy con issue aperte (#1277, #1278) e il rewrite v4 e' ancora draft; ble-manager e' New-Arch only ma va validato su dispositivo reale; react-native-bluetooth-classic ha solo tag rc (1.73.0-rc.17).
- Qualita' degli adattatori: cloni v1.5/v2.1 basati su firmware v1.4 con comportamenti imprevedibili, BLE con UUID e MTU diversi, sleep assente (scarica batteria); costi di supporto elevati; mitigare con sonda capacita', banner e lista adattatori consigliati.
- Aspettative utente vs realta': molte funzioni desiderate (olio, pneumatici, pastiglie, salute batteria, SoC EV, km) non sono accessibili con OBD standard: rischio recensioni negative e reclami se la comunicazione e' ingannevole.
- Mode 04 e revisione: cancellare codici perde freeze frame/monitor e puo' dare falsa sicurezza; rischio reputazionale/legale se pubblicizzata impropriamente.
- Evoluzione normativa/tecnica: OBDonUDS (J1979-2) obbligatorio negli USA dal MY2027, Euro 7 da novembre 2026 per nuovi tipi, Regolamento delegato UE 2026/699 (in vigore 2026-06-23) con autenticazione degli strumenti: i lettori ELM327 generici potrebbero smettere di funzionare su modelli recenti (impatto UE non verificato in fonte primaria).
- Licenze: contaminare il codice con GPL/CC-NC (python-OBD, ELM327-emulator, emulatore Android GPL-3.0, obd-parser GPL-3.0) impedirebbe la distribuzione commerciale chiusa; i database PID di marca sono proprietari e quelli di comunita' senza licenza.
- Privacy: VIN + account = dato personale (CGUE C-319/22); sincronizzazione cloud richiede informativa, base giuridica, Data safety/privacy label.
- Policy store: App Review richiede dimostrazione con hardware; Play richiede targetSdk 36 e, se in futuro background/foreground service connectedDevice, dichiarazioni dedicate; consumo batteria auto da adattatore sempre inserito potrebbe generare reclami.
- Fonti secondarie/non verificate: layout OBFCM Mode 09 0917, ordine esatto dei bit di PID 0101 byte B, UUID ISSC/NUS per OBD, cifre di assorbimento dei cloni, date Euro 7: da confermare su veicoli/adattatori reali prima di basarci funzioni.

## Domande aperte

- Quali adattatori ha gia' l'utente (Classic o BLE? marca/modello) e quali auto di prova (benzina/diesel, anno, EOBD CAN o K-line, ibrida/EV)? Serve per dare priorita' a trasporti e profili.
- Quale libreria BLE funziona davvero su Expo SDK 57 (New Architecture) con write-without-response e notifiche su OBDLink CX, Veepeak, Vgate iCar Pro: ble-manager 12.5.3 o ble-plx 3.5.1? Richiede test su telefono reale.
- Quali PID rispondono sulle auto di prova: 012F, 015C, 0142, 01A6, 0131, Mode 09 0917 (OBFCM, layout), PID 0101 byte B/C/D (conferma dell'ordine dei bit)?
- L'UE adotta OBDonUDS (J1979-2) e con quale calendario sotto Euro 7? Il Reg. delegato 2026/699 limita l'accesso OBD emissioni generico (Mode 01/03) o solo funzioni oltre l'OBD?
- Mode 04: quali negative response (7F 04 xx) danno le auto di prova con motore acceso, e come reagiscono le ECU ai monitor di prontezza dopo la cancellazione?
- Come fa il controllo scantool della revisione italiana a leggere i km (Mode 09 0917, UDS di marca, altro)? Se e' via OBFCM/standard, il 'km in vita' potrebbe essere una fonte affidabile per le auto 2021+.
- Quali DTC description database con licenza compatibile e traduzione italiana sono utilizzabili commercialmente (dtc-lookup MIT, obd2hq dataset da verificare)?
- Il Classic SPP su Android merita il costo di una libreria con solo tag rc, o conviene puntare solo su BLE+WiFi nella v1?
- Licenza effettiva di react-native-ble-plx (npm indica MIT, il file LICENSE in repo e' Apache-2.0) e di poropi/elm327emu (non verificata).

## Esito verifica

Verifica scettica indipendente del 2026-10-07. Metodo: 25 chiamate web (WebSearch/WebFetch, comprese 2 fallite: ICCT 403 e pagina Apple non leggibile), lettura locale del datasheet ELM327 (revisione "DSJ", 94 pagine, la stessa fonte citata dal ricercatore, convertita con pdftotext), lettura locale del PDF Dekra, `npm view` per le versioni e ricalcolo con script Python di tutti gli esempi numerici del file (DTC, bitmask 0100/0900, 0101, formule PID, VIN, MAF, timer ELM). Fonti nuove usate: Wikipedia OBD-II PIDs e ELM327, CSS Electronics PID table, sorgente python-OBD elm327.py, pagina OBDLink CX, documentazione Android Bluetooth permissions e Play target API, OBD Auto Doctor, Punch Through (AccessorySetupKit), Dekra, Noerr, OEIL (Parlamento europeo), progetto obfcm. Risultato complessivo: nessuna affermazione tecnica del ricercatore e' risultata FALSA in modo dimostrabile (smentite: 0), ma 8 punti sono stati corretti o precisati e 15 gruppi di affermazioni restano non verificabili con fonti libere.

### Confermato (26 gruppi di affermazioni)
1. Formule e byte dei PID Mode 01 (0104, 0105, 0106-0109, 010A, 010B, 010C, 010D, 010E, 010F, 0110, 0111, 011F, 0121, 012F, 0130, 0131, 0133, 0142, 0146, 0151, 015B, 015C, 015E, 01A6): identiche su Wikipedia e CSS Electronics (un estrattore aveva restituito per 010F la formula di 010E: errore di estrazione, smentito da CSS, 010F = A-40). Esempi numerici (1726 rpm, 83 C, 50.2 %, 14.5 V, 25.0 L/h, 12345.6 km, 3.29 L/h) ricalcolati: tutti esatti. Fonti: https://en.wikipedia.org/wiki/OBD-II_PIDs , https://www.csselectronics.com/pages/obd2-pid-table-on-board-diagnostics-j1979
2. Layout PID 0101 (A7 MIL, A6-A0 conteggio; B7 riservato, B6-B4 completezza, B3 tipo motore, B2-B0 disponibilita'; ordine per bit misfire/fuel/components; byte C/D benzina e diesel, C4 = GPF su benzina, C1 NOx/SCR e C0 NMHC su diesel): Wikipedia. Esempio '41 01 82 07 65 04' ricalcolato: MIL on, 2 DTC, EVAP non completo.
3. Decodifica DTC (bit 7-6 lettera P/C/B/U, bit 5-4 prima cifra, nibble basso e secondo byte) e tutti e sei gli esempi (P0133, U0100, U1016, B0123, C0123, C0220): ricalcolati e coerenti con datasheet e Wikipedia.
4. Formato Mode 03: non-CAN = '43' + 3 slot da 2 byte con padding 00; CAN = byte di conteggio dei DTC in seconda posizione (il datasheet la descrive come 'extra data byte' dopo il 43). Esempio a 3 DTC (008 / 0: ... / 1: ...) ricalcolato (8 byte, C0220 giusto).
5. VIN Mode 09: '49 02 01' + 17 byte ASCII; CAN ATH0 con riga '014' (20 byte = 3 + 17); ATH1 con 10 14 / 21 / 22 (6+7+7 byte); J1850 con 5 righe e 3 filler 00 iniziali (esempio identico nel datasheet). Ricostruzione 'ZFA19900001234567' ricalcolata, 17 caratteri.
6. Algoritmo bitmask 0100/0120/.../0900: esempio '41 00 BE 3E B8 11' -> 01 03 04 05 06 07 0B 0C 0D 0E 0F 11 13 14 15 1C 20; '0900' -> '49 00 55 40 00 00' -> 02 04 06 08 0A. Ricalcolati.
7. Sequenza di init: coincide con python-OBD (ATZ, ATE0, ATH1, ATL0, ATRV, ATSP0, 0100, ATDPN, attesa 1 s dopo ATZ), ordine di ripiego protocolli ["6","8","1","7","9","2","3","4","5","A"] e soglia ATRV < 6 V: https://raw.githubusercontent.com/brendan-w/python-OBD/master/obd/elm327.py
8. ATSP0 non scrive in EEPROM (anche SP A0/0A), ATSP n (n diverso da 0) salva sempre il protocollo con ~30 ms di scrittura, ATTP non salva, ATSP00 cancella il protocollo salvato, protocollo fisso che fallisce da' 'BUS INIT: ...ERROR' senza altre ricerche, memoria M1 ricorda il protocollo trovato (datasheet pag. 25-26).
9. Timer: ATST hh = hh x 4 ms (20 ms con CTM5 su CAN), default 0x32 (~200 ms); ATSW hh x 20 ms, default ~3 s; Adaptive Timing AT0/AT1 (default)/AT2; cifra del numero di risposte (v1.3+); esempio datasheet ~90 ms = ~6 letture/s, con cifra 10-12 risposte/s; avvertenza su J1850 PWM e acknowledgement (pag. 32, 52).
10. Storia versioni ELM327: v1.4a mai esistita ('Elm Electronics never made a v1.4a'), v1.5 inesistente (Wikipedia: versioni rilasciate 1.0, 1.0a, 1.1, 1.2, 1.2a, 1.3, 1.3a, 1.4, 1.4b, 2.0, 2.1, 2.2 e 2.3), firmware v1.4 leggibile con programmatore (origine dei cloni), v2.0 = buffer TX 512 byte + Activity Monitor (AMC/AMT) + CRA con X + SH a 4 byte + impostazioni mantenute dopo Low Power, v2.1 = rilevamento 7F xx 78 con timeout a 5 s + CTM1/CTM5 + controllo frequenza CAN, CRA da v1.3. Fonti: datasheet pag. 90-91, https://en.wikipedia.org/wiki/ELM327
11. Stringhe di errore ELM327: STOPPED (carattere ricevuto durante l'operazione), BUFFER FULL (buffer TX RS232 da 512 byte), DATA ERROR e <DATA ERROR (checksum/formato, anche CAF attivo su protocollo non ISO 15765-4), CAN ERROR, BUS BUSY, BUS ERROR, FB ERROR, LV RESET (reset completo come ATZ), ERR94 (errore CAN fatale, impostazioni ai default, da v1.3a blocca le ricerche CAN), NO DATA, UNABLE TO CONNECT, <RX ERROR, '?' (datasheet pag. 86-89).
12. ISO-TP/multi-linea: con CAF1 e ATH0 riga di lunghezza a 3 cifre hex e righe '0:' '1:' '2:'; con ATH1 si vedono i byte PCI (10 xx, 21, 22); esempio 09 04 con due ECU (7E8/7E9) in cui le righe si mescolano con ATH0: identico al datasheet. Limite FF a 12 bit = 4095 byte. Flow control inviato dall'ELM.
13. Multi-PID solo su CAN, max 6 PID per richiesta, esempio '01 0B 04 0C 05' -> '41 0B 21 04 3F 0C 17 B8 05 44' (datasheet pag. 45), valori ricalcolati (MAP 33 kPa, carico 24.7 %, 1518 rpm, 28 C).
14. Effetti Mode 04 secondo datasheet pag. 35: azzera il contatore DTC, cancella DTC, freeze frame, DTC che ha originato il freeze frame, dati test sonde O2, informazioni Mode 06/07; NON cancella i permanenti (Mode 0A); risposta '44'; alcuni veicoli richiedono accensione ON e motore spento; lo standard prevede la conferma 'Are you sure?' a carico del software, non dell'ELM; il veicolo puo' girare male per breve tempo.
15. OBDLink CX: servizio FFF0, FFF1 = notifiche, FFF2 = scrittura, 180A Device Information, FEF5 uso interno; MTU max 247; nessuna queued write; bonding abilitato nei primi 5 minuti dall'accensione con PIN 123456; comunicazione sempre cifrata; solo BLE 5.1: https://support.obdlink.com/support/solutions/articles/43000746707-obdlink-cx-adapter-notes
16. Vgate iCar Pro BLE: servizio 0x18F0, 0x2AF0 INDICATE+NOTIFY, 0x2AF1 WRITE+WRITE NO RESPONSE (fonte secondaria ABRP): https://abrp.featurebase.app/p/i-plugged-an-obd-vgate-icar-pro-ble-40-unfortunatly-2
17. Android 12+: manifest con BLUETOOTH/BLUETOOTH_ADMIN maxSdkVersion 30, BLUETOOTH_SCAN (con usesPermissionFlags neverForLocation) e BLUETOOTH_CONNECT; con neverForLocation 'some BLE beacons are filtered'; senza il flag serve ACCESS_FINE_LOCATION; su Android 11 e inferiori la scansione richiede ACCESS_FINE_LOCATION: https://developer.android.com/develop/connectivity/bluetooth/bt-permissions
18. Play: dal 2026-08-31 nuove app e aggiornamenti devono avere targetSdk 36 (Android 16), estensione richiedibile fino al 2026-11-01, app esistenti almeno API 35 per restare disponibili su dispositivi con Android piu' recente: https://developer.android.com/google/play/requirements/target-sdk
19. iOS: i Classic funzionano solo se MFi verificati (OBDLink MX+, vLinker FS, vLinker MS); elenco marchi BLE iOS (Carista, CYEL, FIXD, Kiwi 3/4, LELink, MicroTech, OBDLink CX, Tonwon, UniCarScan, Veepeak, Vgate, Viecar, Yawoa): https://www.obdautodoctor.com/help/articles/supported-obd-adapters/
20. Revisione italiana: DD 11-08-2023 e circolare 33287 del 07-11-2023; M1, M2, N1 Euro 5/6 immatricolati dal 01/09/2009; controllo visivo MIL (acceso a quadro acceso/motore spento, spento a motore avviato) + lettura strumentale; esito IRREGOLARE se MIL ON 'indipendentemente dal numero di errori letti'; lettura VIN e km con messaggio di incoerenza (non bloccante); OBFCM solo per immatricolati dopo il 2021-01-01 salvo opposizione del proprietario; il documento NON cita i monitor di prontezza: https://revisione.dekra.it/sites/default/files/Il%20nuovo%20controllo%20Scantool%20OBD.pdf
21. Reg. delegato UE 2026/699: in vigore dal 2026-06-23, scadenze 2026-12-23 / 2027-06-23 / 2028-06-23, autenticazione dello strumento 'necessaria e proporzionata' e non discriminatoria, nessuna distinzione tra OBD generico (Mode 01/03) e altre funzioni (impatto sul generico NON chiarito, come scritto dal ricercatore), nessuna menzione di OBDonUDS/J1979-2/Euro 7: https://www.noerr.com/en/insights/delegated-regulation-eu-2026-699-sets-out-new-guidelines-for-secure-gateways-obd-access-and-rmi
22. Euro 7 (Reg. UE 2024/1257): 2026-11-29 nuovi tipi di auto e furgoni, 2027-11-29 tutti i nuovi veicoli (confidenza da bassa ad alta): https://oeil.europarl.europa.eu/oeil/en/document-summary?id=1784743
23. Versioni npm al 2026-10-07: react-native-ble-manager 12.5.3 (Apache-2.0, modificato 2026-09-21), react-native-ble-plx 3.5.1 (MIT su npm), react-native-tcp-socket 6.4.3, react-native-bluetooth-classic 1.73.0-rc.17 (unico tag latest), expo-sqlite 57.0.4, expo 57.0.27 (coerente con SDK 57).
24. Limiti onesti: nei PID standard consultati non compaiono livello olio, vita olio, intervallo service, TPMS, usura pastiglie, SoH batteria 12V (compaiono solo 015C temperatura olio, 015B vita residua batteria ibrida opzionale, 019A dati sistema ibrido/EV); la formulazione 'non promettere' e' corretta (verifica per assenza non esaustiva: J1979-DA a pagamento non consultato).
25. OBFCM letto anche durante la revisione italiana (elenco di consumi/distanze, inclusi charge-depleting): coerente con la pista del ricercatore.
26. AccessorySetupKit: iOS 18, chiavi NSAccessorySetupBluetoothServices/Names/CompanyIdentifiers (vedi correzione sul nome della chiave Supports).

### Corretto (8)
1. [CORRETTO dalla verifica] Finding 23: la chiave Info.plist e' NSAccessorySetupKitSupports (non NSAccessorySetupSupports); con AccessorySetupKit NSBluetoothAlwaysUsageDescription non va dichiarata; valori nel plist obbligatori.
2. [CORRETTO dalla verifica] Finding 14: l'obbligo OBFCM deriva dal Reg. UE 2018/1832 (Allegato XXII), dal 2021-01-01; il Reg. UE 2021/392 riguarda monitoraggio/trasmissione dei dati.
3. [CORRETTO dalla verifica] Finding 5: MTU massimo Android 517 (non 512).
4. [CORRETTO dalla verifica] Finding 5: la regola 'mai piu' di MTU-3 byte' non vale per write-without-response su OBDLink CX (overhead 12 byte, quindi MTU-12).
5. [CORRETTO dalla verifica] Finding 16 e Sintesi/Raccomandazioni: il 24-02-2024 e' la data entro cui i centri devono avere lo strumento OBD (software PCP/PCS entro il 2024-01-31), non una decorrenza uniforme per i veicoli; nel documento Dekra se lo scantool non comunica entro 120 s il test e' 'incompleto con esito regolare'.
6. [CORRETTO dalla verifica] Finding 20: 'Unione EU: dal 2024-02-24' e' una procedura italiana, non UE.
7. [CORRETTO dalla verifica] Finding 17: l'odometro 01A6 non e' semplicemente 'opzionale': e' obbligatorio per i veicoli certificati CARB dal MY2019 (Wikipedia); per le auto europee nessun obbligo trovato; 'la maggior parte delle auto non risponde' e' senza fonte, formulare come 'supporto variabile, da sondare'.
8. [CORRETTO dalla verifica] Finding 7: ACT ALERT e' un preavviso annullabile (circa 1 minuto prima), LP ALERT e' l'avviso a 2 s non annullabile.

### Smentito (0)
Nessuna affermazione e' risultata dimostrabilmente falsa. Le ipotesi piu' esposte (UUID Vgate iCar e ISSC, OBFCM 0917, NRC 7F 04 22) non sono state ne' confermate ne' smentite: vedi sotto.

### Da verificare (15)
1. [DA VERIFICARE] UUID E7810A71-73AE-499D-8C15-FAA9AEF0C3F2 / BEF8D6C9-9C21-4C9E-B632-BD58C1009F9F (Vgate iCar iOS): ricerca indipendente senza risultati.
2. [DA VERIFICARE] UUID ISSC/Microchip 49535343-...: ricerca indipendente senza risultati.
3. [DA VERIFICARE] Mode 09 infotype 0x17 per OBFCM (alias UDS 22F817), header 7E0, layout a 16 byte: solo progetto amatoriale (layout confermato su un unico Ford E-350 2020 USA, verified=False); non nella tabella Wikipedia (infotype 00-0B); J1979-DA a pagamento; il Reg. 2018/1832 pubblica i parametri ma non byte order/scaling (secondo il progetto). Il dato '12% di veicoli con dati corrotti' non riscontrato.
4. [DA VERIFICARE] Sentinel 0xFFFFFFFF per 01A6 (attestato solo per OBFCM).
5. [DA VERIFICARE] NRC '7F 04 22' per Mode 04 a motore acceso (il datasheet dice solo 'ignition on but engine not running').
6. [DA VERIFICARE] Reset dei monitor di prontezza dopo Mode 04: non nel datasheet ELM327, J1979 a pagamento; effetto ampiamente noto ma da provare con 0101 prima/dopo su un'auto reale.
7. [DA VERIFICARE] MTU iOS 135/158/185 per iOS 8/9/10+.
8. [DA VERIFICARE] Android 14 invia automaticamente MTU 517 (thread Nordic non riletto).
9. [DA VERIFICARE] python-OBD 'aspetta fino a 10 s' su 0100 (nel sorgente: attese di 1 s).
10. [DA VERIFICARE] 'A/C refrigerant' come variante storica del bit C4/D4 benzina (Wikipedia riporta solo GPF).
11. [DA VERIFICARE] Apple: NSBluetoothAlwaysUsageDescription (iOS 13+), NSBluetoothPeripheralUsageDescription deprecata, NSLocalNetworkUsageDescription (iOS 14+), UIBackgroundModes bluetooth-central: pagina Apple non leggibile con WebFetch; coerente con la fonte Punch Through ma non riletta in primaria.
12. [DA VERIFICARE] Android: foreground service connectedDevice da Android 14 con FOREGROUND_SERVICE_CONNECTED_DEVICE e BLUETOOTH_CONNECT; plugin Expo di ble-plx e sue opzioni: non riverificati.
13. [DA VERIFICARE] OBDonUDS obbligatorio in UE; date CARB MY2027, DID 0xF4B2 SoH ZEV, 'Volvo/Mack dal 2024': non riverificati (le fonti nuove non li citano).
14. [DA VERIFICARE] Link dtc-lookup con grafia dell'owner incoerente (Gershy13 nel finding 15, Gershel13 nel finding 28).
15. [DA VERIFICARE] Non riverificati per budget (nessun indizio di errore, semplicemente non controllati): WiFi 192.168.0.10:35000 e prompt Rete locale iOS, dati di Car Scanner/Torque/OBD Fusion/Carly (finding 18), cifre di assorbimento degli adattatori (finding 24), licenze di python-OBD / ELM327-emulator / emulatore Android / altre librerie (finding 27-28), EOBD 2001/2004 e CAN in UE (finding 20), CGUE C-319/22 e Data Act (finding 29), prestazioni BLE ~8 Hz, EAS Free, Expo SDK 57/RN 0.86/Node 22.13, giudizi di qualita' degli adattatori.

### Fatti importanti omessi dal ricercatore
1. Datasheet ELM327 (pag. 32): prima del J1979 di aprile 2002 le richieste J1850 piu' frequenti di una ogni 100 ms erano vietate e i veicoli precedenti possono non tollerare un polling veloce; il tetto di 4-8 Hz del finding 8 va quindi reso adattivo per i veicoli J1850 (rari in Europa, presenti nelle importazioni).
2. Datasheet pag. 88: dopo ERR94 il blocco della ricerca sui protocolli CAN resta fino a spegnimento/riaccensione dell'adattatore o ATFE (ATZ NON basta); dopo LV RESET il blocco dura fino al prossimo reset (ATZ, WS) o ATFE. Un'app che vede 'UNABLE TO CONNECT' dopo ERR94 o LV RESET su un'auto CAN dovrebbe proporre di scollegare e ricollegare l'adattatore o inviare ATFE, non solo riprovare.
3. Datasheet pag. 45: la risposta a una richiesta multi-PID su CAN e' essa stessa multi-frame ('00A / 0: ... / 1: ...') e l'ordine dei PID nella risposta puo' non coincidere con quello richiesto; il parser deve riassemblare ISO-TP prima di scomporre i PID (il file la mostra come singola riga '41 0B 21 ...').
4. Datasheet pag. 52: l'esempio '6 letture/s, 10-12 con la cifra' e' tratto da un veicolo J1850 VPW con due ECU, non da un'auto CAN moderna: le prestazioni reali con BLE e CAN vanno misurate, non assunte.
5. Datasheet pag. 45: con v2.1 l'ELM gestisce il 'response pending' portando il timeout a 5 s solo per CAN e ISO 14230 (PP 2A); con i cloni (firmware 1.4) la gestione manuale di 7F xx 78 e' obbligatoria, come gia' scritto, e il timeout da usare e' 5 s.
6. Android: BLUETOOTH_CONNECT e' richiesto anche per connettersi via GATT a un dispositivo non accoppiato (la documentazione consultata lo descrive solo per i dispositivi 'already-paired'; verificare sull'API reference di connectGatt); neverForLocation filtra alcuni beacon BLE, trascurabile per OBD.
7. iOS AccessorySetupKit (iOS 18): se usato, non si deve dichiarare NSBluetoothAlwaysUsageDescription e i filtri nome/servizio/company identifier nel plist sono obbligatori, pena terminazione dell'app.
8. Revisione italiana: il consenso alla lettura OBFCM va chiesto nella domanda di revisione prima delle operazioni; il controllo VIN/km produce un messaggio di incoerenza verso il PCS (non blocca); se la presa OBD non e' accessibile o lo strumento non comunica entro 120 s il test e' 'incompleto con esito regolare' (le cause vengono monitorate). Il criterio di esito e' il MIL, non i monitor di prontezza.
9. Wikipedia Mode 09 include anche l'infotype 0B (in-use performance tracking per motori ad accensione per compressione), omesso nel finding 14; il PID 01A6 e' obbligatorio per i veicoli CARB MY2019+, quindi su auto di mercato USA recenti la lettura del chilometraggio via OBD e' attesa.
10. La copia del datasheet citata (ELM327DSJ) descrive le versioni fino alla 2.1; le differenze di v2.2 e v2.3 non sono documentate nelle fonti consultate (le due versioni esistono, secondo Wikipedia): un clone non va classificato in base alla stringa di versione.
11. Il sorgente python-OBD usa ATZ, ATE0, ATH1, ATL0 (headers attivi dall'inizio); la sequenza raccomandata nel finding 6 (ATE0, ATL0, ATS0, ATH1) e' una scelta di progetto del ricercatore, non quella del riferimento: nessuna contraddizione, ma ATS0 non e' nel riferimento, quindi il parser deve accettare sia il formato con spazi sia quello senza (gia' previsto dalla raccomandazione sui test).
