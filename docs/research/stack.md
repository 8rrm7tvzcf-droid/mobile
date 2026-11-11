# Scelta dello stack - AutoGarage (ricerca del 2026-10-07)

> Stato: COMPLETO (tutte le sezioni compilate; lacune dichiarate nella sezione 14). Data di riferimento: 2026-10-07.
> **VERIFICATO da uno scettico indipendente il 2026-10-07**: le righe marcate [CORRETTO dalla verifica], [SMENTITO], [DA VERIFICARE], [INTEGRATO dalla verifica] sono state modificate/aggiunte dalla verifica; il riepilogo e' nella sezione finale "## Esito verifica".
> Convenzione: ogni punto riporta confidenza (alta/media/bassa) e fonti (URL). Per i pacchetti npm la "fonte" e' `npm view` / `npm pack` eseguiti il 2026-10-07.
> Contesto: app mobile (iOS + Android) in italiano per la gestione delle auto con lettura OBD-II via Bluetooth/Wi-Fi; sviluppatore singolo su Windows 11 (Node 24.19.0, npm 11.17.0) senza Android SDK/Java/Xcode.

## 1. Raccomandazione sintetica

**Stack scelto (confidenza media-alta):** Expo **SDK 57** (`expo ~57.0.27`, rilasciato il 30 giugno 2026) + **React Native 0.86.3** + React 19.2.3 + TypeScript ~6.0.3, New Architecture (obbligatoria da RN 0.82), `expo-router ~57.0.25` con `src/app`, **development build via EAS Build cloud** e config plugin. Tutto lo sviluppo quotidiano gira su Windows 11 con Node 24.19.0 senza Java/Android SDK/Xcode.

Decisioni chiave e relativo rischio:
1. **BLE:** `react-native-ble-manager 12.5.3` (TurboModule, manutenzione attiva, plugin Expo) come implementazione primaria, `react-native-ble-plx 3.5.1` come alternativa/fallback; entrambe dietro `ObdTransport`. Rischio: nessuna delle due provata qui su RN 0.86 -> **spike su dispositivo obbligatorio** (sezione 12). Confidenza media.
2. **Bluetooth Classic SPP (solo Android):** `react-native-bluetooth-classic 1.73.0-rc.17`, opzionale e isolata; confidenza **bassa**. **Wi-Fi ELM327:** `react-native-tcp-socket 6.4.3` (iOS e Android). Su iOS niente Classic (serve MFi).
3. **Dati:** `expo-sqlite ~57.0.4` + `drizzle-orm 0.45.3` / `drizzle-kit 0.31.11` (linea stabile; la 1.0 e' ancora RC). SQLite e' l'unica fonte di verita'; backup/export con `expo-file-system` + `expo-sharing`.
4. **Notifiche:** `expo-notifications ~57.0.22` con finestra mobile (max ~50 pendenti su iOS, limite 64), **senza** `SCHEDULE_EXACT_ALARM` (Expo ripiega su alarm inesatto consegnato anche in Doze); promemoria anche "dentro l'app" calcolati dal DB.
5. **Store:** MVP senza foreground service e senza `bluetooth-central` in background (connessione OBD in primo piano). SDK 57 e' gia' conforme al target API 36 richiesto da Play dal 31 agosto 2026.
6. **Non adottare ora:** SDK 58 (beta dal 15 settembre 2026), `react-native 0.87`, `react 19.3`, `typescript 7`, `jest 30`, `eslint 10`, `gesture-handler 3.x`, Drizzle 1.0 RC: o non sono supportati dall'SDK 57 o rompono i tool Expo (sezione 8).
7. **Costi minimi:** sviluppo e prove Android a 0 USD (EAS Free); Play Console 25 USD una tantum; Apple Developer 99 USD/anno (indispensabile per provare su iPhone).

Come leggere il resto: sez. 2 confronto; sez. 3 stato SDK; sez. 4 BLE/Classic/Wi-Fi; sez. 5 notifiche; sez. 6 store; sez. 7 pacchetti; sez. 8 incompatibilita'; sez. 9 scaffolding; sez. 10 cartelle; sez. 11-12 esecuzione su Windows e BLE reale; sez. 13 distribuzione; sez. 14 lacune.

## 2. Confronto (a) Expo+RN vs (b) Flutter vs (c) nativo

Dati di partenza verificati il 2026-10-07: Flutter stable **3.47.6** (2026-10-01, releases JSON di Google); `flutter_blue_plus` **2.3.14** (2026-10-03); `flutter_reactive_ble` **5.6.0** (2026-09-23, BSD-3, solo Android/iOS); `drift` **2.35.1** (2026-09-30, MIT); `flutter_local_notifications` **22.3.1** (2026-09-13); `permission_handler` **13.0.2**. Fonte: API pub.dev (https://pub.dev/api/packages/<nome>), https://storage.googleapis.com/flutter_infra_release/releases/releases_windows.json

**Fatto determinante sulla licenza (alta confidenza):** `flutter_blue_plus` e' distribuito con la "FlutterBluePlus License Version 1.6": le organizzazioni **a scopo di lucro devono acquistare una licenza commerciale** (a scaglioni per numero di dipendenti) e "use during development, testing, or evaluation by a for-profit organization is considered commercial use"; uso gratuito per persone fisiche (uso personale), no-profit e istituti educativi. pub.dev lo marca `license:unknown`. Fonte: https://pub.dev/packages/flutter_blue_plus/license . L'alternativa `flutter_reactive_ble` e' BSD-3. [INTEGRATO dalla verifica: la licenza 1.6 (https://raw.githubusercontent.com/boskokg/flutter_blue_plus/master/LICENSE.md, letta il 2026-10-07) prevede anche un "Build-Time License Ping": il software "may attempt to send limited license telemetry at build time" (nome pacchetto, nome app, versione app, versione FBP, data) - omesso dal ricercatore; confidenza alta.] Se l'app fosse pubblicata a nome dell'azienda, la scelta Flutter+FBP avrebbe un costo/obbligo legale da chiarire.

| Criterio | (a) Expo SDK 57 + RN 0.86 (New Arch) + TS | (b) Flutter 3.47 + flutter_blue_plus/reactive_ble + drift | (c) Nativo (Kotlin + Swift) |
|---|---|---|---|
| Affidabilita' BLE ELM327 | **Media**: due librerie valide (ble-manager TurboModule attivo; ble-plx legacy via interop con bug iOS noti), nessuna provata qui su RN 0.86; mitigazione: interfaccia `ObdTransport` + spike | **Buona/Media**: plugin molto usati e manutenuti (FBP rilasciato il 2026-10-03); ma FBP e' a pagamento per aziende, `flutter_reactive_ble` solo BLE nativo | **Migliore**: accesso diretto a CoreBluetooth/BluetoothGatt, foreground service e state restoration completi |
| Bluetooth Classic SPP (Android) | **Debole**: solo `react-native-bluetooth-classic` (RC, legacy, nessun plugin Expo, non provata su RN 0.86). Fallback: modulo Expo custom in Kotlin | Medio (non verificato in questa ricerca: confidenza bassa) | **Migliore** (`BluetoothSocket` SPP) |
| Sviluppo su Windows SENZA Android SDK | **Si'**: EAS Build nel cloud (piano gratuito 15+15 build/mese), anteprima web, Expo Go | **No per le build Android locali**: Flutter richiede l'Android SDK per compilare APK (non riletto in questa run, confidenza media); anteprima su Chrome/Windows possibile; nessun servizio di build ospitato ufficiale equivalente a EAS (CI di terzi non esaminate) | **No**: Android Studio/SDK e, per iOS, Xcode su macOS: incompatibile con i vincoli |
| Anteprima UI su PC con OBD simulato | **Si'** (`expo start --web`, `MockTransport`); SQLite web in alpha | Si' (Chrome); BLE reale su web non utile | Solo con emulatori (non disponibili) |
| Notifiche locali affidabili | `expo-notifications` 57: Android `setExactAndAllowWhileIdle` se permesso, altrimenti `setAndAllowWhileIdle`, ripianifica a riavvio/aggiornamento (letto nel sorgente); iOS: finestra mobile da 64 | `flutter_local_notifications` 22.3.1: maturo e molto diffuso (7.352 like), stessi limiti di piattaforma | Pieno controllo (WorkManager/AlarmManager, UNUserNotificationCenter), stessi limiti iOS |
| Regole store (Play FGS, Apple background) | Gestite via config plugin; MVP senza FGS ne' `bluetooth-central` | Equivalenti | Equivalenti (maggior controllo) |
| Offline-first / DB | `expo-sqlite` 57 + Drizzle 0.45 (SQLCipher opzionale; web alpha) | `drift` 2.35 (MIT, 160/160 punti pub, molto completo) | Room / Core Data o SQLite diretto, due implementazioni |
| Produttivita' singolo sviluppatore + Claude Code | **Alta**: un solo codebase TS, test vitest su Node, hot reload | Alta ma Dart/Flutter su Windows richiede toolchain (Android SDK) per provare sul telefono | **Bassa**: due codebase e due toolchain |
| Rischio principale | librerie native di terze parti con New Arch-only; salto di SDK ogni ~4 mesi | licenza FBP, toolchain locale | impossibilita' pratica con i vincoli dati |

**Verdetto (confidenza media-alta): (a) Expo SDK 57 + React Native 0.86.3 (New Architecture) + TypeScript, con development build e config plugin.** Soddisfa i vincoli duri (Windows senza Android SDK, build nel cloud, anteprima web con adattatore simulato, un solo sviluppatore). Il punto debole (BLE/Classic su RN 0.86) si governa con un'interfaccia di trasporto e uno spike su dispositivo; se entrambe le librerie BLE risultassero instabili, il piano B resta in Expo: un piccolo **Expo Module** nativo scritto in Kotlin/Swift (compilato da EAS nel cloud, senza SDK locale; confidenza media) oppure il fork `@sfourdrinier/react-native-ble-plx` 3.9.3 (TurboModule, ma di un solo maintainer, ~2.600 download/sett.). Flutter sarebbe l'alternativa credibile solo a due condizioni: chiarire la licenza di FBP (o usare `flutter_reactive_ble`) e accettare di installare l'Android SDK.

## 3. Stato reale a ottobre 2026: Expo SDK, React Native, New Architecture

| Fatto verificato | Valore | Confidenza | Fonte |
|---|---|---|---|
| SDK Expo stabile corrente | **SDK 57** (`expo@57.0.27`, dist-tag `latest`); rilasciato il 30 giugno 2026 | alta | `npm view expo dist-tags`; https://expo.dev/changelog (voce "Expo SDK 57 released, June 30, 2026") |
| SDK 58 | in **beta** dal 15 settembre 2026 (`expo@next` = 58.0.6): NON adottarlo ora | alta | https://expo.dev/changelog ; `npm view expo dist-tags` |
| React Native fissato da SDK 57 | **0.86.3** (NON l'ultimo su npm, che e' 0.87.1) | alta | `bundledNativeModules.json` dentro `expo@57.0.27` (npm pack); https://expo.dev/changelog/sdk-57 |
| React fissato da SDK 57 | **19.2.3** (l'ultimo su npm e' 19.3.0: non usarlo) | alta | idem |
| TypeScript nel template SDK 57 | `~6.0.3` (l'ultimo su npm e' 7.0.2: non usarlo finche' il template non lo adotta) | alta | `npm view expo-template-default@sdk-57 devDependencies` |
| New Architecture | **unica architettura possibile** da RN 0.82 in poi: `newArchEnabled=false` / `RCT_NEW_ARCH_ENABLED=0` vengono ignorati. RN 0.81 / Expo SDK 54 sono le ultime versioni con la Legacy Architecture. Il template SDK 57 non contiene piu' `newArchEnabled`. Ogni modulo nativo di terze parti deve quindi funzionare in New Arch (TurboModule oppure layer di interop per i vecchi moduli a bridge) | alta | https://reactnative.dev/blog/2025/10/08/react-native-0.82 ; `app.json` del template `expo-template-default@57.0.29` |
| Template ufficiale SDK 57 | `expo-template-default@57.0.29`: usa `src/app` (expo-router), `experiments.typedRoutes: true` e `experiments.reactCompiler: true` in `app.json`, Metro per il web (`web.output: static`) | alta | `npm pack expo-template-default@57.0.29` (ispezionato localmente) |
| Expo Go: login obbligatorio | dal 3 settembre 2026 serve essere loggati (`npx expo login` + login nell'app) per eseguire progetti in Expo Go; per ora solo iOS, Android "in futuro"; non serve per dev build ne' simulatori | alta | https://expo.dev/changelog/expo-go-57-login |
| Expo Go ritarda sugli store | a maggio 2026 sugli store c'era Expo Go per SDK 54 (SDK 55 in attesa di approvazione App Store); `eas go` (build Expo Go personalizzata caricata via TestFlight sul proprio account Apple) richiede l'Apple Developer Program. **[CORRETTO dalla verifica]** Il post del 3 settembre 2026 dice solo che Expo Go "has recently been updated in the Apple App Store" e supporta SDK 57: la data esatta di pubblicazione non e' dichiarata (3 settembre e' la data del post) e **la disponibilita' su Google Play per SDK 57 NON e' confermata da nessuna fonte** -> [DA VERIFICARE] su Android (controllare la versione di Expo Go sul telefono prima di contare su di essa). Il post su `eas go` e' quello di maggio (non quello del login); `eas go` e' citato per SDK 55 e 56 su iOS | alta (iOS), **bassa (Android SDK 57)** | https://expo.dev/changelog/expo-go-and-app-store-may-2026 ; https://expo.dev/changelog/expo-go-57-login ; https://expo.dev/changelog/sdk-57 (al lancio del 30 giugno la nuova versione di Expo Go era "still waiting on approval") |
| Durata del supporto | SDK 54 (settembre 2025) riceve solo fix critici "until the next SDK release (September or October 2026)": cio' conferma che SDK 58 stabile e' imminente (ottobre-novembre 2026, data esatta non pubblicata) | media | https://expo.dev/changelog/sdk-57 |

**Implicazione pratica.** Scaffoldare con SDK 57 (`create-expo-app@latest` -> `expo-template-default@57.0.29`) e usare SEMPRE `npx expo install <pkg>` per ogni pacchetto con versione nativa (vedi sezione 7), perche' molte librerie su npm hanno gia' versioni piu' nuove di quelle compatibili con RN 0.86.3 (es. `react-native-gesture-handler` latest 3.3.0 vs richiesto `~2.32.0`; `react-native-reanimated` latest 4.7.1 vs richiesto 4.5.1). Pianificare la migrazione a SDK 58 dopo la sua versione stabile (con `npx expo install expo@^58 --fix`).

## 4. BLE e Bluetooth Classic per adattatori ELM327

Premessa tecnica (alta): iOS non puo' parlare con adattatori ELM327 Bluetooth **Classic** (SPP) se non MFi; su iOS servono adattatori **BLE** (o **Wi-Fi**). Su Android funzionano Classic SPP, BLE e Wi-Fi. Gli ELM327 economici "v1.5" sono quasi sempre Classic: la scelta del trasporto va quindi esposta in app (BLE / Classic (solo Android) / Wi-Fi). Fonte per la limitazione iOS: README di react-native-bluetooth-classic ("External Accessory framework ... requires MFi compliance"), https://github.com/kenjdavidson/react-native-bluetooth-classic

### 4.1 Candidati BLE (dati verificati il 2026-10-07)

| Libreria | Versione | Ultima release | Download/sett. (npm) | Architettura nativa | Config plugin Expo | Note |
|---|---|---|---|---|---|---|
| **react-native-ble-plx** | 3.5.1 | 2026-02-18 | ~239.700 | **Vecchio bridge** (`ReactContextBaseJavaModule` / `RCT_EXPORT_METHOD`, nessun `codegenConfig`): in RN 0.86 gira solo tramite il layer di interop | Si', incluso (`app.plugin.js`): opzioni `isBackgroundEnabled`, `neverForLocation`, `modes` (`central`/`peripheral`), `bluetoothAlwaysPermission` | Peer `react: *`, `react-native: *` (non vincola). Maintainer upstream poco reattivo (nessun commit di roadmap TurboModule trovato). **[INTEGRATO dalla verifica]** API GitHub (2026-10-07): ultimo commit su `master` il 2026-03-09 (merge PR #1330, un fix dopo la 3.5.1 MAI rilasciato su npm: `latest` resta 3.5.1 del 2026-02-18, nessun dist-tag `next`); ~7 mesi senza attivita' di codice; 33 issue aperte (non PR); repository non archiviato; pacchetto non deprecato su npm. Confermati: `ReactContextBaseJavaModule` (Android) e `RCT_EXPORT_METHOD` (iOS), `codegenConfig` assente |
| **react-native-ble-manager** | 12.5.3 | 2026-09-21 (release 12.4.5 mar, 12.5.0 mag, 12.5.1 lug, 12.5.2 set 2026) | ~132.800 | **TurboModule/Fabric** (`codegenConfig` `BleManagerSpec`); README: "RN 0.76+ only the new architecture is supported" | Si', incluso: `isBleRequired`, `neverForLocation`, `companionDeviceEnabled`, `bluetoothAlwaysPermission` (NON gestisce `UIBackgroundModes`: si aggiunge in `app.json` -> `ios.infoPlist`) | iOS 15.1+, Android API 23+ (come dichiara il README; [NOTA dalla verifica] il podspec dichiara `:ios, "11.0"` e il default Gradle e' `minSdkVersion` 24: incoerenza solo di documentazione, irrilevante con SDK 57 che impone iOS 16.4 / minSdk 24); licenza Apache-2.0; API a eventi (`startNotification`, `write`, `writeWithoutResponse`) |
| `@sfourdrinier/react-native-ble-plx` (fork) | 3.9.3 | 2026-07-28 | ~2.600 | TurboModule, richiede RN >= 0.86 e Expo SDK 57+ | Si' (`EXPO_PLUGIN.md`), con foreground service Android e state restoration iOS | **Fork di un solo maintainer**, API con breaking change rispetto a upstream; adozione bassa. Solo ripiego, non default |

Fonti: `npm view` e `npm pack` (ispezione locale del codice dei pacchetti); https://cdn.jsdelivr.net/npm/@sfourdrinier/react-native-ble-plx@3.9.2/docs/FORK.md ; README `react-native-ble-manager@12.5.3`.

**Problemi noti di react-native-ble-plx con la New Architecture (confidenza media):**
- Issue #1278 (aperta, 24 feb 2025): crash in **release build iOS** con New Arch su RN 0.77.1 + ble-plx 3.5.0. Causa riportata: `createClient` riceve `null` come `NSString*` e `startDeviceScan` riceve `null` al posto di array/dizionari; nella 3.5.1 il sorgente iOS e' invariato (`createClient:(NSString*)restoreIdentifierKey`) e il JS passa ancora `null` (`BleModule.createClient(options.restoreStateIdentifier || null)`). Rimedio dell'issue: patch (`patch-package`) con tipo `id` + controlli nil/NSNull. Fonte: https://github.com/dotintent/react-native-ble-plx/issues/1278 ; verifica sul sorgente di 3.5.1 (npm pack).
- Issue #1323 (aperta, 11 gen 2026): NullPointerException in `BlePlxModule` su timeout GATT in disconnessione (Android). Fonte: https://github.com/dotintent/react-native-ble-plx/issues?q=is%3Aissue+%22new+architecture%22
- Issue #1277 "RN New Architecture Compatibility" aperta da feb 2025 senza risposta ufficiale di roadmap. Stessa fonte.
- NON verificato in esecuzione: non abbiamo testato ne' ble-plx ne' ble-manager su un dispositivo con RN 0.86. Va fatto uno spike prima di fissare la scelta (sezione 12).

**Stato di react-native-ble-manager (pagina issue GitHub consultata il 2026-10-07, confidenza media):** solo **7 issue aperte**; le piu' recenti sono iOS: #1439 (5 ott 2026) `retrieveServices` manda in crash l'app quando la tabella GATT in cache di una periferica *bonded* e' obsoleta; #1438 (25 set 2026) `retrieveServices` concorrenti su periferiche che condividono lo stesso UUID di servizio possono bloccarsi; #1411 (6 gen 2026) `BleManager.start()` chiamato due volte non fa reject (si blocca); #1386 (6 ott 2025) restoreState su iOS 26. Nessuna issue riporta problemi specifici di Expo SDK 55-57 o RN 0.83-0.86 (assenza di segnalazioni, non prova di funzionamento). Fonte: https://github.com/innoveit/react-native-ble-manager/issues . Mitigazioni progettuali: chiamare `start()` una sola volta (singleton), serializzare `retrieveServices` (una sola connessione/adattatore alla volta, coda di comandi), non fare affidamento sul bonding su iOS.
Dettagli del plugin (letti nel sorgente 12.5.3): scrive `NSBluetoothAlwaysUsageDescription` (testo personalizzabile con `bluetoothAlwaysPermission`), permessi Android `BLUETOOTH`, `BLUETOOTH_ADMIN`, `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN` (con `usesPermissionFlags="neverForLocation"` se `neverForLocation: true`) e i permessi di posizione limitati a `maxSdkVersion=30` quando `neverForLocation: true`; `uses-feature bluetooth_le` solo se `isBleRequired: true` (lasciare `false`, cosi' l'app e' installabile anche da chi usa solo Wi-Fi/Classic).

**Raccomandazione BLE (confidenza media):** dietro un'interfaccia `ObdTransport` (vedi struttura cartelle) usare **react-native-ble-manager 12.5.3** come implementazione BLE primaria (TurboModule dichiarato, manutenzione attiva, plugin Expo). Tenere **react-native-ble-plx 3.5.1** come seconda implementazione sperimentale/fallback (con `patch-package` per i `null` iOS), perche' e' la libreria piu' diffusa e documentata. Poiche' l'accesso e' isolato dall'interfaccia, cambiare libreria costa poco. Decisione definitiva dopo lo spike su dispositivo reale.

### 4.2 Bluetooth Classic SPP (solo Android)

| Libreria | Versione | Ultima release | Download/sett. | Architettura | Config plugin |
|---|---|---|---|---|---|
| **react-native-bluetooth-classic** | 1.73.0-rc.17 (dist-tag `latest` e' una *release candidate*) | 2025-11-19 | ~22.500 | vecchio bridge (`RNBluetoothClassicModule`), nessun `codegenConfig`; peer `react-native >=0.73.1` | **Nessuno** incluso. Esiste `with-rn-bluetooth-classic@1.0.5` (2022, abbandonato): meglio scrivere un piccolo plugin locale per `BLUETOOTH_CONNECT`/`BLUETOOTH_SCAN` |
| react-native-bluetooth-serial e derivati | 2017-2021 | abbandonate | n/d | - | - |

Valutazione: l'unica opzione Classic ancora aggiornata e' react-native-bluetooth-classic, ma e' un modulo legacy, in RC da oltre un anno, ultima release novembre 2025 e senza prova di funzionamento su RN 0.86 (confidenza **bassa**). Va trattata come modulo **opzionale e isolato** (`Platform.OS === 'android'`, caricamento dinamico), con lo spike su dispositivo come criterio di accettazione. Fonti: `npm view`, `npm pack` (ispezione codice); https://github.com/kenjdavidson/react-native-bluetooth-classic ; https://www.npmjs.com/package/with-rn-bluetooth-classic (via ricerca npm).

### 4.3 Trasporto Wi-Fi (alternativa solida, confidenza media)
Gli ELM327 Wi-Fi espongono un socket TCP (tipicamente `192.168.0.10:35000`); funzionano su iOS e Android senza permessi Bluetooth, ma richiedono di collegare il telefono all'hotspot dell'adattatore (niente Internet nel frattempo). Libreria: **react-native-tcp-socket 6.4.3** (release 2026-09-10, ~112.200 download/sett., MIT, peer `react-native >=0.60.0`, modulo nativo: richiede dev build). Su iOS serve la dichiarazione "Local Network" (`NSLocalNetworkUsageDescription`). Fonte: `npm view` / `npm pack`. **[INTEGRATO dalla verifica]** (omesso dal ricercatore) `react-native-tcp-socket` 6.4.3 e' anch'esso un **modulo legacy a bridge** (`TcpSocketModule.java`, `RCT_EXPORT_MODULE()` in `TcpSockets.m`, nessun `codegenConfig`) che in RN 0.86 gira solo tramite il layer di interop, esattamente come `react-native-ble-plx`; non include un config plugin Expo (nessun `app.plugin.js`; quindi `NSLocalNetworkUsageDescription` va messo a mano in `ios.infoPlist`). Repository non archiviato, ultimo push 2026-09-10, 32 issue/PR aperte (API GitHub). Il layer di interop e' mantenuto "for the foreseeable future" secondo il blog ufficiale RN 0.82 (https://reactnative.dev/blog/2025/10/08/react-native-0.82), ma il funzionamento di questo modulo su RN 0.86 resta [DA VERIFICARE] nello spike su dispositivo (come per ble-plx). Confidenza media.

## 5. Notifiche locali (iOS 64 pendenti, Android exact alarm / Doze / riavvio)

### 5.1 Fatti verificati

| Tema | Fatto | Confidenza | Fonte |
|---|---|---|---|
| Trigger disponibili in `expo-notifications` | `DATE` (iOS+Android), `TIME_INTERVAL`, `DAILY` (iOS+Android); `WEEKLY`, `MONTHLY`, `YEARLY` solo Android; `CALENDAR` solo iOS | alta | https://docs.expo.dev/versions/latest/sdk/notifications/ |
| API di gestione | `scheduleNotificationAsync`, `cancelScheduledNotificationAsync(id)`, `cancelAllScheduledNotificationsAsync()`, `getAllScheduledNotificationsAsync()` | alta | stessa pagina |
| Limite iOS | iOS tiene solo le **64 notifiche locali piu' vicine nel tempo**; le altre vengono scartate. Non e' nella documentazione Expo: e' un limite di sistema, riportato dai forum Apple (staff e sviluppatori). Soluzione standard: finestra mobile ("rolling window") che ripianifica le prossime N a ogni apertura/ripresa dell'app. **[INTEGRATO dalla verifica]** Riconfermato il 2026-10-07 sul thread Apple 811171: il sistema tiene le 64 notifiche con scadenza piu' vicina e scarta le altre; una richiesta con trigger ripetuto (rescheduled automatically) conta come UNA sola notifica - potenzialmente utile per scadenze ricorrenti (la doc Expo dichiara `YEARLY`/`MONTHLY`/`WEEKLY` solo su Android e `CALENDAR` solo su iOS: come si comporti il ripetersi in `expo-notifications` su iOS rispetto al conteggio e' [DA VERIFICARE]), ma il limite riguarda le richieste pendenti, non le consegne. Nessuna pagina di documentazione Apple/Expo che riporti il 64 e' stata trovata (Apple Developer Forums = fonte di staff/sviluppatori) | alta (limite), media (fonte non e' pagina di documentazione ufficiale) | https://developer.apple.com/forums/thread/811171 ; https://developer.apple.com/forums/thread/106829 |
| Android: tipo di alarm usato da Expo | In `expo-notifications@57.0.22` (`ExpoSchedulingDelegate.kt`, riga ~106): se Android < 12 oppure `canScheduleExactAlarms()` e' vero usa `setExactAndAllowWhileIdle`; **altrimenti ripiega su `setAndAllowWhileIdle`** (inesatto, ma consegnato anche in Doze). Il manifest della libreria **non** dichiara `SCHEDULE_EXACT_ALARM` | alta (letto nel sorgente del pacchetto) | `npm pack expo-notifications@57.0.22` (ispezione locale); https://docs.expo.dev/versions/latest/sdk/notifications/ |
| Android 13+: `SCHEDULE_EXACT_ALARM` | negata di default per le nuove installazioni; revocabile; `USE_EXACT_ALARM` concesso automaticamente ma limitato a sveglie/calendari e soggetto alla policy Play | alta | https://developer.android.com/develop/background-work/services/alarms/schedule |
| Android: riavvio | Gli alarm sono cancellati allo spegnimento. `expo-notifications` dichiara `RECEIVE_BOOT_COMPLETED` e un receiver (`NotificationsService`) su `BOOT_COMPLETED`, `REBOOT`, `QUICKBOOT_POWERON` e `MY_PACKAGE_REPLACED` che ripianifica le notifiche salvate | alta | manifest del pacchetto 57.0.22 (npm pack); https://developer.android.com/develop/background-work/services/alarms/schedule |
| Android 13+: permesso notifiche | `POST_NOTIFICATIONS` e' dichiarato dalla libreria; il prompt runtime compare dopo la creazione del primo canale (`setNotificationChannelAsync`) | alta | manifest del pacchetto; documentazione Expo sopra |
| Doze | Gli alarm inesatti con `setAndAllowWhileIdle` possono slittare ma vengono consegnati; gli alarm normali sono rimandati fino all'uscita da Doze; i produttori (Xiaomi, Huawei, Samsung, ecc.) possono comunque killare l'app/cancellare gli alarm (limite non documentato da Google: confidenza bassa sui dettagli per produttore) | media | developer.android.com (sopra) |
| Expo Go | Le notifiche **locali** funzionano in Expo Go; il **push remoto** non e' disponibile in Expo Go su Android da SDK 53 (qui non serve: niente server) | alta | https://docs.expo.dev/versions/latest/sdk/notifications/ |
| Config plugin `expo-notifications` | opzioni `icon` (96x96 PNG bianco), `color`, `defaultChannel`, `sounds`, `enableBackgroundRemoteNotifications` | alta | stessa pagina |

### 5.2 Decisioni di progetto che ne derivano
1. **Non dichiarare `SCHEDULE_EXACT_ALARM` ne' `USE_EXACT_ALARM`.** Le scadenze auto (bollo, assicurazione, revisione, tagliando) non richiedono precisione al secondo; l'inesatto con `setAndAllowWhileIdle` e' sufficiente e il fallback e' gia' nella libreria. Evita anche la revisione policy Play sugli exact alarm (la policy sugli exact alarm e' citata nella pagina Android; la procedura di dichiarazione Play non e' stata approfondita: confidenza bassa).
2. **Notifiche con orario "giornaliero" (es. 09:00) al giorno X-30/X-7/X-1/X** costruite con trigger `DATE`, non con intervalli relativi, cosi' sopravvivono a riavvio e cambio di orario.
3. **Sorgente di verita' = database SQLite**, non il sistema di notifiche. Un modulo `ReminderScheduler` ricalcola e ripianifica: a ogni avvio/ritorno in foreground, dopo ogni modifica di scadenza, e (best-effort) dal task in background. Su iOS pianificare al massimo ~50 notifiche (margine sotto 64) ordinate per data; su Android **[CORRETTO dalla verifica]** NON "tutte senza limite": il framework Android impone un tetto di **500 alarm concorrenti per app/UID** (`MAX_ALARMS_PER_UID`; storicamente oltre il tetto veniva lanciata `SecurityException: Too many alarms (500) registered from uid`; un commit AOSP successivo, "Stop crashing the system on hitting the alarm limit", ha cambiato la gestione per non mandare in crash il sistema: il comportamento esatto per versione non e' stato verificato). Il tetto non e' nella documentazione developer.android.com ma nel codice AOSP (https://android.googlesource.com/platform/frameworks/base/+/87fd50612963); confidenza media. Poiche' `expo-notifications` registra un alarm per ogni notifica pianificata (`setupAlarm` in `ExpoSchedulingDelegate.kt`), la finestra mobile (poche decine di notifiche pendenti, non centinaia) conviene anche su Android.
4. **Fallback "dentro l'app":** schermata/badge "Scadenze in arrivo" calcolata dal DB, indipendente dalle notifiche (se l'utente nega il permesso o il produttore killa gli alarm l'informazione resta visibile).
5. Guidare l'utente su Android a escludere l'app dall'ottimizzazione batteria solo come suggerimento opzionale (`expo-intent-launcher` e' disponibile, versione 57.0.1), mai come requisito.
6. Calendario di sistema come canale alternativo opzionale (`expo-calendar` 57.0.5): non necessario in MVP.

## 6. Regole store (Google Play, Apple App Store)

### 6.1 Google Play

| Tema | Regola / fatto | Cosa fare in AutoGarage | Confidenza | Fonte |
|---|---|---|---|---|
| Target API | Dal **31 agosto 2026** nuove app e aggiornamenti devono avere `targetSdk` >= **36 (Android 16)** (estensione richiedibile fino al 1 novembre 2026); le app esistenti devono puntare almeno API 35 per restare visibili a nuovi utenti su dispositivi recenti | SDK 57 usa come default `compileSdk 36`, `targetSdk 36`, `minSdk 24` (letto in `expo-modules-core@57.0.21`): conforme senza interventi. [NOTA dalla verifica: riletto `ExpoModulesCorePlugin.gradle` (compileSdk 36, minSdk 24, targetSdk 36) e `Expo.podspec` (iOS 16.4) - ma sono valori di fallback `safeExtGet(...)` per i moduli Expo; il `targetSdkVersion` effettivo dell'APK/AAB dipende dalla configurazione root di React Native 0.86 / `expo-build-properties`: [DA VERIFICARE] sul primo build EAS (es. `aapt dump badging` o l'avviso della Play Console)] | alta (requisito Play: confermato; scadenza estendibile al 1 novembre 2026; app esistenti: API 35) | https://support.google.com/googleplay/android-developer/answer/11926878 ; `npm pack expo-modules-core@57.0.21` |
| Permessi Bluetooth | Android 12+ (API 31): runtime `BLUETOOTH_SCAN` e `BLUETOOTH_CONNECT` ("dispositivi nelle vicinanze"). Android 11 e precedenti: la scansione BLE richiede la posizione. Con `neverForLocation` la posizione non e' piu' richiesta da Android 12 | `neverForLocation: true` nel plugin BLE: nessuna richiesta di posizione su Android 12+; il plugin limita i permessi di posizione a `maxSdkVersion=30` (letto nel sorgente) | alta (plugin), media (regole di sistema, non riletta su developer.android.com in questa run) | sorgente plugin `react-native-ble-manager@12.5.3` |
| Servizi foreground | Dal Android 14 (API 34) ogni FGS deve avere un tipo; per Bluetooth/dispositivi esterni il tipo e' `connectedDevice` (richiede `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_CONNECTED_DEVICE` e almeno un permesso runtime tra `BLUETOOTH_CONNECT`/`BLUETOOTH_SCAN`/...); le app che puntano ad Android 14+ devono **dichiarare i tipi di FGS nella pagina "Contenuti dell'app" di Play Console**; avvio da background limitato dalle regole Android 12+; `connectedDevice` non ha timeout | **MVP: nessun FGS** (connessione OBD solo con app in primo piano). Se in futuro si vuole registrare un viaggio a schermo spento: FGS `connectedDevice` + dichiarazione Play | alta | https://developer.android.com/develop/background-work/services/fgs/service-types |
| Alarm esatti | `SCHEDULE_EXACT_ALARM` negato di default su Android 13+; `USE_EXACT_ALARM` limitato a sveglie/calendari e soggetto alla policy Play | non dichiarare nessuno dei due (sez. 5) | alta | https://developer.android.com/develop/background-work/services/alarms/schedule |
| Notifiche | `POST_NOTIFICATIONS` runtime su Android 13+ | gestito da `expo-notifications` (dichiarato nel suo manifest) | alta | manifest di `expo-notifications@57.0.22` |
| **[INTEGRATO dalla verifica] Verifica sviluppatore Android (omessa dal ricercatore)** | Google richiede la registrazione/verifica dell'identita' dello sviluppatore per le app installate su dispositivi Android certificati. Dal **30 settembre 2026** le protezioni partono in Brasile, Indonesia, Singapore e Thailandia (Android 7+); la verifica sara' estesa "globalmente per tutte le app su dispositivi certificati nel 2027" (quindi anche l'Italia). Vale anche per le app NON distribuite da Play (sideload di APK; la pagina primaria e' formulata come "apps from participating stores", le fonti secondarie - https://9to5google.com/2025/08/25/android-apps-developer-verification/ , https://www.bitdefender.com/en-au/blog/hotforsecurity/google-developer-verification-sideloaded-apps - dicono esplicitamente che include il sideloading: confidenza media su questo punto): ci si registra con Google Play Console (Play + fuori Play) oppure con la nuova Android Developer Console (solo fuori Play); esiste un "limited distribution account" gratuito per studenti/hobbisti fino a 20 dispositivi senza documento ne' tassa; resta un "advanced flow" per installare app non verificate | Impatta la distribuzione di APK interni EAS ("internal distribution", sez. 13) quando la regola arrivera' in Italia: l'account Play Console da 25 USD (gia' previsto per il rilascio) copre la registrazione; per le prove su pochi telefoni propri il limited distribution account o l'installazione via `adb`/dev build resta praticabile (installazione via ADB: non esplicitamente indicata come esente nella pagina letta, [DA VERIFICARE]) | alta (date e regole: pagina primaria) | https://developer.android.com/developer-verification |
| Account sviluppatore | **25 USD una tantum**; account Personale o Organizzazione; documento d'identita' e carta di credito a nome legale; i **nuovi account personali** creati dopo il 13 novembre 2023 devono soddisfare requisiti di test prima della pubblicazione. [INTEGRATO dalla verifica: pagina ufficiale riletta il 2026-10-07: "US$25 one-time registration fee"; serve un documento d'identita' governativo valido e una carta di credito entrambi a nome legale; eta' minima 18 anni; i nuovi account personali richiedono anche la verifica del dispositivo con l'app mobile Play Console] | decidere subito se pubblicare a nome personale o dell'azienda | alta (costo e esistenza del requisito: confermati) | https://support.google.com/googleplay/android-developer/answer/6112435 |
| Test per account personali | **[CORRETTO dalla verifica]** La pagina UFFICIALE di Play Console Help (answer 14151465, letta il 2026-10-07) conferma: i nuovi account **personali** (creati dopo il 13 novembre 2023) "must run a closed test before applying to publish your app to production" con **almeno 12 tester iscritti ininterrottamente per almeno 14 giorni** (chi esce e rientra riparte da zero); poi si usa "Apply for production" e si rispondono a 3 sezioni di domande (test, app, prontezza). La pagina cita il requisito solo per gli account personali: l'esenzione degli account Organizzazione e' coerente ma non dichiarata esplicitamente | pianificare 2-3 settimane di closed testing prima del rilascio se account personale | **alta** (pagina ufficiale) | https://support.google.com/googleplay/android-developer/answer/14151465 (le fonti non ufficiali del ricercatore - testerscommunity.com, levelup.gitconnected.com - non servono piu') |

### 6.2 Apple App Store

| Tema | Regola / fatto | Cosa fare in AutoGarage | Confidenza | Fonte |
|---|---|---|---|---|
| Versione minima iOS | SDK 57 usa deployment target **iOS 16.4** (`Expo.podspec`, `ExpoModulesCore.podspec`); `react-native-ble-manager` richiede iOS 15.1+ | nessuna azione | alta | `npm pack expo@57.0.27`, `expo-modules-core@57.0.21` |
| Permesso Bluetooth | serve `NSBluetoothAlwaysUsageDescription` con motivazione in italiano chiara | plugin `react-native-ble-manager` con `bluetoothAlwaysPermission` | alta | sorgente plugin |
| Background Bluetooth | `UIBackgroundModes` = `bluetooth-central` permette in background di scoprire/connettersi, interagire con i dati e sottoscrivere notifiche; la scansione in background richiede UUID di servizio espliciti e ignora i duplicati; ~10 secondi di esecuzione al risveglio; la ripresa dopo terminazione richiede *state restoration* (`CBCentralManagerOptionRestoreIdentifierKey`, `willRestoreState`). La pagina Apple e' **documentazione archiviata del 2013** | **MVP: non dichiarare `bluetooth-central`** (connessione in primo piano). Dichiararlo senza una funzione reale rischia domande in revisione **[INTEGRATO dalla verifica]** Riletta la guideline ufficiale (https://developer.apple.com/app-store/review/guidelines/, 2026-10-07): la 2.5.4 dice che le app multitasking possono usare i servizi in background solo per gli scopi previsti ("VoIP, audio playback, location, task completion, local notifications, etc."); **non esiste una guideline numerata dedicata al Bluetooth/accessori MFi**; la 5.1.1(i) impone in ogni caso link alla privacy policy nei metadata di App Store Connect e dentro l'app | alta (contenuto della pagina), bassa (esito revisione: non prevedibile da testo) | https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/CoreBluetoothBackgroundProcessingForIOSApps/PerformingTasksWhileYourAppIsInTheBackground.html |
| Bluetooth Classic su iOS | non utilizzabile con ELM327 comuni: serve l'External Accessory framework e hardware MFi | su iOS offrire solo BLE e Wi-Fi; spiegarlo in app (schermata "Adattatori compatibili") | alta | README di `react-native-bluetooth-classic`: https://github.com/kenjdavidson/react-native-bluetooth-classic |
| Wi-Fi ELM327 | l'app si collega a un host locale (es. 192.168.0.10:35000): serve la dichiarazione "Local Network" (`NSLocalNetworkUsageDescription`) | aggiungere in `app.json` -> `ios.infoPlist` quando si implementa il trasporto Wi-Fi | media (regola nota, non riletta su fonte Apple in questa run) - **[DA VERIFICARE]** (non verificato nemmeno dalla verifica scettica; nessuna fonte primaria citata) | - |
| **[INTEGRATO dalla verifica] Xcode/SDK minimo per i caricamenti (omesso)** | Dal **28 aprile 2026** le app caricate su App Store Connect devono essere compilate con **Xcode 26 o successivo** e SDK iOS 26 (iOS/iPadOS 26). Dal 9 settembre 2026 il target minimo per iOS/iPadOS e' iOS 13 (SDK 57 usa 16.4: nessun problema) | le build iOS le fa EAS nel cloud: verificare che l'immagine macOS usata da EAS per SDK 57 includa Xcode 26+ (non verificato, [DA VERIFICARE]) | alta (requisito Apple), bassa (immagine EAS) | https://developer.apple.com/news/upcoming-requirements/ |
| Notifiche locali | limite 64 pendenti (sez. 5) | finestra mobile | alta | forum Apple, sez. 5 |
| Programma sviluppatori | **99 USD / anno**; account individuale: nome legale come venditore; organizzazione: D-U-N-S, sito web, autorita' legale | decidere individuale vs organizzazione | alta | https://developer.apple.com/programs/enroll/ |
| TestFlight | tester interni fino a **100** (utenti App Store Connect); esterni fino a **10.000**; la prima build per tester esterni richiede App Review (beta); le build restano testabili fino a **90 giorni** | usare tester interni per le prime fasi | alta | https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/ |

## 7. Tabella completa dei pacchetti (versioni verificate con npm view, 2026-10-07)

Metodo (alta confidenza): (1) `npm view <pkg> version` per l'ultima versione su npm; (2) la colonna "Versione da usare" per i pacchetti Expo/nativi proviene da `bundledNativeModules.json` dentro `expo@57.0.27` (e' la stessa tabella che `npx expo install` / `npx expo install --check` usa per decidere le versioni compatibili); (3) l'intero set e' stato fatto risolvere con `npm install --package-lock-only` in una cartella temporanea: **nessun conflitto ERESOLVE**, una sola copia di `react` (19.2.3) e `react-native` (0.86.3), solo avvisi su peer opzionali di `@hookform/resolvers`. Non e' stato eseguito `npx expo install --check` (richiede un progetto gia' creato): va lanciato come primo controllo dopo lo scaffolding.

Regola d'oro: **installare con `npx expo install <pkg>`** i pacchetti marcati "Expo"; usare `npm install <pkg>@<versione esatta>` per quelli marcati "libero".

### 7.1 Base, navigazione, UI nativa

| Pacchetto | Versione da usare (SDK 57) | Ultima su npm | Tipo | Note / compatibilita' |
|---|---|---|---|---|
| expo | ~57.0.27 | 57.0.27 | Expo | `latest` = SDK 57; `next` = 58.0.6 (beta, da evitare) |
| react | 19.2.3 | 19.3.0 | Expo | NON aggiornare a 19.3: SDK 57 fissa 19.2.3 |
| react-dom | 19.2.3 | 19.3.0 | Expo | solo web |
| react-native | 0.86.3 | 0.87.1 | Expo | NON aggiornare a 0.87: non supportato da SDK 57 |
| react-native-web | ~0.21.0 | 0.21.3 | Expo | anteprima web |
| expo-router | ~57.0.25 | 57.0.25 | Expo | file-based routing, typed routes |
| expo-linking, expo-constants, expo-status-bar, expo-font, expo-splash-screen, expo-system-ui | ~57.0.12, ~57.0.21, ~57.0.1, ~57.0.4, ~57.0.9, ~57.0.4 | uguali | Expo | gia' nel template |
| react-native-screens | ~4.26.0 | 4.28.0 | Expo | expo-router richiede `^4.26.0` |
| react-native-safe-area-context | ~5.7.0 | 5.10.1 | Expo | |
| react-native-gesture-handler | ~2.32.0 | **3.3.0** | Expo | **NON installare la 3.x** con SDK 57 |
| react-native-reanimated | 4.5.1 | 4.7.1 | Expo | peer di expo-router; richiede `react-native-worklets` 0.10.1 (ultima 0.13.0: non usare) |
| react-native-worklets | 0.10.1 | 0.13.0 | Expo | |
| react-native-svg | 15.15.4 | 15.15.5 | Expo | usato dai grafici |
| expo-dev-client | ~57.0.19 | 57.0.19 | Expo | necessario per le development build |
| expo-build-properties | ~57.0.22 | 57.0.22 | Expo | per `minSdkVersion`/`targetSdkVersion`/`deploymentTarget` se servono |
| expo-image / expo-symbols / expo-web-browser | ~57.0.5 / ~57.0.3 / ~57.0.3 | uguali | Expo | gia' nel template |
| expo-linear-gradient | ~57.0.2 | 57.0.2 | Expo | peer di `react-native-gifted-charts` |
| @shopify/flash-list | 2.0.2 | 2.3.3 | Expo | liste lunghe (storico rifornimenti/interventi) |
| typescript | ~6.0.3 | **7.0.2** | libero (come da template) | restare su 6.0.x finche' il template Expo non passa a 7 |
| @types/react | ~19.2.2 | 19.3.0 | Expo | |

### 7.2 Bluetooth / OBD

| Pacchetto | Versione | Ultima su npm | Tipo | Note |
|---|---|---|---|---|
| react-native-ble-manager | 12.5.3 | 12.5.3 | libero | **BLE primario consigliato**; TurboModule; plugin `react-native-ble-manager` |
| react-native-ble-plx | 3.5.1 | 3.5.1 | libero | alternativa/fallback; modulo legacy via interop; plugin `react-native-ble-plx`; vedi sezione 4 |
| react-native-bluetooth-classic | 1.73.0-rc.17 | 1.73.0-rc.17 | libero | solo Android, opzionale, senza plugin Expo (serve plugin locale) |
| react-native-tcp-socket | 6.4.3 | 6.4.3 | libero | trasporto Wi-Fi ELM327 (TCP 35000) |

Nota: in `package.json` tenere **una sola** libreria BLE per volta nel build di produzione (evita doppio plugin e permessi duplicati); la seconda va aggiunta solo per l'esperimento (spike).

### 7.3 Dati, file, sicurezza, sistema

| Pacchetto | Versione da usare | Ultima su npm | Tipo | Note |
|---|---|---|---|---|
| expo-sqlite | ~57.0.4 | 57.0.4 | Expo | DB locale; web in **alpha** (vedi sez. 11) |
| drizzle-orm | 0.45.3 | 0.45.3 (`latest`, pubblicata il 2026-09-21); **[CORRETTO dalla verifica]** il dist-tag `rc` e' **1.0.0-rc.4** (2026-06-27); `1.0.0-rc.5` come versione "pulita" NON esiste su npm: esistono solo snapshot con hash (`1.0.0-rc.5-5935859` del 2026-09-09, tag `rc5`) | libero | usare la linea stabile 0.45.x: la 1.0 e' ancora RC/beta. Peer `expo-sqlite >=14` soddisfatto |
| drizzle-kit | 0.31.11 | 0.31.11 (`latest`, 2026-09-21); **[CORRETTO dalla verifica]** `rc` = 1.0.0-rc.4 (non rc.5; rc.5 esiste solo come snapshot con hash `rc5`) | libero (dev) | `driver: 'expo'` in `drizzle.config.ts` |
| babel-plugin-inline-import | 3.0.0 | 3.0.0 | libero (dev) | per importare le migrazioni `.sql` |
| expo-file-system | ~57.0.7 | 57.0.7 | Expo | API a oggetti `File`/`Directory`/`Paths` e' il default; la vecchia API sta in `expo-file-system/legacy` |
| expo-document-picker | ~57.0.3 | 57.0.3 | Expo | import backup / allegati PDF |
| expo-image-picker | ~57.0.20 | 57.0.20 | Expo | foto libretto, scontrini |
| expo-sharing | ~57.0.22 | 57.0.22 | Expo | esportazione backup/CSV/PDF |
| expo-print | ~57.0.2 | 57.0.2 | Expo | PDF dello storico (opzionale) |
| expo-secure-store | ~57.0.4 | 57.0.4 | Expo | chiave di cifratura/PIN, non per dati voluminosi |
| expo-local-authentication | ~57.0.3 | 57.0.3 | Expo | blocco app con biometria (opzionale) |
| expo-localization | ~57.0.2 | 57.0.2 | Expo | lingua/regione di sistema (it-IT) |
| expo-crypto | ~57.0.3 | 57.0.3 | Expo | UUID per record offline-first |
| expo-device | ~57.0.2 | 57.0.2 | Expo | diagnostica supporto |
| expo-keep-awake | ~57.0.2 | 57.0.2 | Expo | schermo acceso durante la lettura OBD (opzionale) |
| expo-intent-launcher | ~57.0.1 | 57.0.1 | Expo | apre le impostazioni batteria su Android (opzionale) |

### 7.4 Notifiche e background

| Pacchetto | Versione da usare | Ultima su npm | Tipo | Note |
|---|---|---|---|---|
| expo-notifications | ~57.0.22 | 57.0.22 | Expo | notifiche locali; vedi sezione 5 |
| expo-background-task | ~57.0.21 | 57.0.21 | Expo | WorkManager (Android, min 15 min) / BGTaskScheduler (iOS); sostituisce `expo-background-fetch` |
| expo-task-manager | ~57.0.21 | 57.0.21 | Expo | richiesto da `expo-background-task` per `defineTask` |

### 7.5 Stato, form, i18n, date, grafici

| Pacchetto | Versione da usare | Ultima su npm | Tipo | Note |
|---|---|---|---|---|
| zustand | 5.0.15 | 5.0.15 | libero | stato UI/sessione OBD (non per i dati persistenti: quelli stanno in SQLite) |
| react-hook-form | 7.89.0 | 7.89.0 | libero | |
| @hookform/resolvers | 5.9.1 | 5.9.1 | libero | peer `zod ^3.25 || ^4`, `react-hook-form ^7.55` OK |
| zod | 4.6.5 | 4.6.5 | libero | usare `import { z } from 'zod'` (v4) |
| i18next | 26.4.2 | 26.4.2 | libero | |
| react-i18next | 17.0.16 | 17.0.16 | libero | peer `i18next >= 26.2.0` OK, `typescript ^5 || ^6 || ^7` OK |
| date-fns | 4.4.0 | 4.4.0 | libero | locale `it` da `date-fns/locale` |
| react-native-gifted-charts | 1.4.81 | 1.4.81 | libero | grafici SVG (linee/barre) funzionanti anche su web; ~285.800 download/sett. |
| victory-native (alternativa) | 42.0.1 | 42.0.1 | libero | richiede `@shopify/react-native-skia` 2.6.2 (versione SDK) + reanimated + gesture-handler; ~520.900 download/sett.; su web serve CanvasKit (non verificato: confidenza bassa) |
| @react-native-community/datetimepicker | 9.1.0 | 9.2.1 | Expo | selettore date nativo (la 9.1.0 e' quella dell'SDK) |

### 7.6 Test, lint, formattazione

| Pacchetto / strumento | Versione da usare | Ultima | Note |
|---|---|---|---|
| jest-expo | ~57.0.5 | 57.0.5 | preset Jest per Expo; dipende da `@react-native/jest-preset ^0.86.3` |
| jest | ~29.7.0 | **30.5.2** | **usare Jest 29**: `jest-expo` 57 dipende da `babel-jest`/`@jest/globals` `^29` |
| @types/jest | ~29.5.14 | 30.0.0 | allineato a Jest 29 |
| @testing-library/react-native | 14.0.1 | 14.0.1 | peer `jest >=29`, `react >=19`, `react-native >=0.78`, e **`test-renderer ^1.0.0`** |
| test-renderer | 1.3.0 | 1.3.0 | nuova dipendenza peer di RNTL 14 (coesiste con `react-test-renderer` 19.2.3 portato da jest-expo) |
| vitest | 5.0.3 | 5.0.3 | solo per TS puro (parser OBD, calcolo scadenze, regole di ripianificazione): esegue su Node senza React Native |
| Maestro (CLI, non npm) | cli-2.11.0 (2026-09-29) | - | E2E su Android; richiede Java 17+ e adb (vedi sez. 11); non testa il BLE reale |
| eslint | ^9.39.5 | 10.12.0 | **restare su ESLint 9 (prudenza)**: `expo lint` installa `eslint ^9.0.0` di default (verificato in `@expo/cli@57.0.28`); [CORRETTO dalla verifica] il runtime accetta ESLint >= 8.57, quindi non e' un blocco tecnico dimostrato |
| eslint-config-expo | ~57.0.2 | 57.0.2 | flat config (`eslint.config.js`) |
| prettier | 3.9.9 | 3.9.9 | |
| eas-cli | 24.11.0 (usare via `npx eas-cli@latest` o globale) | 24.11.0 | non e' una dipendenza del progetto |
| create-expo-app | 5.0.0 (usato da `npx create-expo-app@latest`) | 5.0.0 | scaffolding |

Fonti della sezione: `npm view` per tutte le versioni; `bundledNativeModules.json` di `expo@57.0.27`; peer dependencies lette con `npm view <pkg>@<ver> peerDependencies`; https://github.com/mobile-dev-inc/maestro/releases (API releases/latest) per Maestro; https://docs.expo.dev/versions/latest/sdk/filesystem/ ; https://docs.expo.dev/versions/latest/sdk/background-task/ ; https://orm.drizzle.team/docs/connect-expo-sqlite.

## 8. Incompatibilita note

| # | Problema | Effetto | Rimedio | Confidenza |
|---|---|---|---|---|
| 1 | Su npm `react-native` (0.87.1), `react` (19.3.0), `react-native-gesture-handler` (3.3.0), `react-native-reanimated` (4.7.1), `react-native-worklets` (0.13.0), `react-native-screens` (4.28.0), `react-native-safe-area-context` (5.10.1), `@shopify/flash-list` (2.3.3) sono piu' nuovi delle versioni dell'SDK 57 | un `npm install pkg@latest` rompe la build nativa (versioni native non allineate a RN 0.86.3) | usare solo `npx expo install`; `npx expo install --check` prima di ogni build EAS | alta |
| 2 | `typescript` 7.0.2 e' la `latest` su npm, il template SDK 57 usa `~6.0.3` | tooling Expo/ESLint non garantito con TS 7 | pin `~6.0.3` | media (non provato con TS 7) |
| 3 | `jest` 30.5.2 e' la `latest`; `jest-expo@57` dipende da Jest 29 | doppio Jest / errori di preset | pin `jest@~29.7.0` | alta (dipendenze lette) |
| 4 | `eslint` 10.12.0 e' la `latest`; `expo lint` installa di default `^9.0.0` (`ESlintPrerequisite.js` in `@expo/cli@57.0.28`) | **[CORRETTO dalla verifica]** non e' dimostrato un "conflitto": `lintAsync.js` accetta ESLint >= 8.57.0 e `eslint-config-expo@57.0.2` ha peer `eslint >=8.10`; il pin a 9 e' una scelta prudente (i plugin trascinati da `eslint-config-expo` potrebbero non supportare ESLint 10: non verificato) | pin `eslint@^9.39.5` (prudenza, non obbligo) | media (pin consigliato), alta (versione installata di default) |
| 5 | `drizzle-orm` `latest` = 0.45.3 ma la documentazione Drizzle per Expo (pagina consultata il 2026-10-07) mostra `drizzle-orm@rc`, `drizzle-kit@rc` e `expo-sqlite@next` (linea 1.0 RC) | seguendo il tutorial alla lettera si installano pacchetti RC e `expo-sqlite@next`, che su npm e' la **58.0.10 (SDK 58 beta)**, non allineata a SDK 57 (verificato con `npm view expo-sqlite dist-tags`: `latest`/`sdk-57` = 57.0.4) | usare 0.45.3 / 0.31.11 e `npx expo install expo-sqlite`; passare a 1.0 solo a release stabile | alta (discrepanza osservata), media (che l'API 0.45 coincida con l'esempio) |
| 6 | `react-native-ble-plx` 3.5.1 e' un modulo legacy: in New Arch-only passa dal layer di interop; issue #1278 (crash iOS release con `null`) non risolta nel sorgente 3.5.1 | possibile crash su iOS in release alla creazione del client o a `startDeviceScan(null, ...)` | preferire `react-native-ble-manager`; se si usa ble-plx: passare sempre un array (anche con UUID dei servizi comuni ELM327) e applicare la patch dell'issue via `patch-package` | media |
| 7 | `react-native-bluetooth-classic` e' in RC (1.73.0-rc.17, nov 2025), modulo legacy, senza plugin Expo | funzionamento su RN 0.86 non provato | isolarlo come funzione opzionale Android + plugin locale per i permessi + spike su dispositivo | bassa |
| 8 | `expo-sqlite` su web e' **alpha** e richiede WASM in Metro e header `Cross-Origin-Embedder-Policy: credentialless` + `Cross-Origin-Opener-Policy: same-origin` | l'anteprima web puo' non aprire il DB | vedere sezione 11 (spike + fallback in-memory) | alta (requisiti documentati), bassa (come impostarli in dev server) |
| 9 | Expo Go richiede il login (dal 2026-09-03, per ora iOS) e ha ritardato di mesi sugli store per gli SDK nuovi (a maggio 2026 sugli store c'era Expo Go per SDK 54) | l'app di test potrebbe non aprirsi su un telefono con Expo Go non aggiornato | verificare la versione di Expo Go prima; preferire la dev build per il lavoro quotidiano; l'interfaccia puo' girare su web | alta |
| 10 | `expo-notifications` non dichiara `SCHEDULE_EXACT_ALARM`; su Android 12+ senza il permesso ripiega su `setAndAllowWhileIdle` (inesatto) | le notifiche possono arrivare con qualche minuto di scarto | accettabile per scadenze giornaliere; NON aggiungere il permesso | alta |
| 11 | iOS: max 64 notifiche locali pendenti | scadenze oltre la 64a vengono perse silenziosamente | finestra mobile con ripianificazione (sez. 5.2) | alta |
| 12 | `expo-file-system`: l'API di default e' cambiata (oggetti `File`/`Directory`); i tutorial vecchi usano `readAsStringAsync` ecc. | errori di import | per codice vecchio importare da `expo-file-system/legacy`; per codice nuovo usare le classi | alta |
| 13 | `expo-background-task`: iOS `BGTaskScheduler` non gira nel simulatore e l'esecuzione e' a discrezione del sistema; intervallo minimo 15 minuti su Android | i promemoria NON devono dipendere dal task in background | usarlo solo per ripianificare in modo opportunistico | alta |

## 9. Scaffolding: comando esatto

Fatti verificati: `create-expo-app` 5.0.0 e' l'ultima su npm; la documentazione ufficiale elenca i flag `--template <default|blank|blank-typescript|tabs|bare-minimum>`, `--yes`, `--no-install`, `--example`, `--no-agents-md` (di default genera `AGENTS.md` e `.claude/settings.json`: utile con Claude Code, si puo' disattivare); `expo-template-default` ha il dist-tag `sdk-57` = 57.0.29 e oggi anche `latest` = 57.0.29. La doc NON descrive la sintassi per fissare lo SDK (`default@sdk-57`) ne' il comportamento con cartella non vuota. **[CORRETTO dalla verifica]** La sintassi e' CONFERMATA dal codice sorgente: in `create-expo@5.0.3` (da cui dipende `create-expo-app@5.0.0` con `create-expo >=5.0.1`) la funzione `getResolvedTemplateName` espande l'alias `default` in `expo-template-default`, passa il tag cosi' com'e' a `npm pack` (quindi `default@sdk-57` -> `expo-template-default@sdk-57`) e converte anche un tag numerico (`default@57` -> `@sdk-57`); il README di `create-expo` mostra `--template expo-template-blank@50`. Confidenza alta sulla sintassi; il comportamento con cartella non vuota resta non verificato. Il dist-tag `sdk-57` = 57.0.29 e `latest` = 57.0.29 sono confermati; esiste anche `sdk-58` = 58.0.15 (= `next`), da NON usare. Fonte: https://docs.expo.dev/more/create-expo/ ; `npm view expo-template-default dist-tags`.

**Comando (PowerShell, dalla cartella del progetto)** - si crea una sottocartella `mobile` per non entrare in conflitto con `docs\`:

```powershell
npx create-expo-app@latest mobile --template default@sdk-57 --no-install
cd mobile
npm install
npx expo --version          # atteso: 57.0.x
npm run reset-project       # sposta il demo in app-example/ e lascia src/app/index.tsx vuoto (script presente nel template 57.0.29)
```

Se la sintassi `default@sdk-57` fosse rifiutata, usare `npx create-expo-app@latest mobile --template default --no-install` (oggi produce comunque SDK 57 perche' `latest` = 57) e controllare che in `package.json` compaia `"expo": "~57.0.x"`. Quando uscira' SDK 58 stabile, `latest` cambiera': per questo conviene fissare il tag.

**Pacchetti da aggiungere** (versioni nella sezione 7; ordine: prima i pacchetti Expo con `expo install`, poi quelli liberi con versione esatta):

```powershell
npx expo install expo-dev-client expo-build-properties expo-sqlite expo-notifications expo-file-system expo-document-picker expo-image-picker expo-sharing expo-secure-store expo-local-authentication expo-localization expo-background-task expo-task-manager expo-device expo-crypto expo-print expo-keep-awake expo-linear-gradient expo-intent-launcher @react-native-community/datetimepicker @shopify/flash-list react-native-svg

npm install react-native-ble-manager@12.5.3 react-native-tcp-socket@6.4.3 drizzle-orm@0.45.3 zustand@5.0.15 react-hook-form@7.89.0 @hookform/resolvers@5.9.1 zod@4.6.5 i18next@26.4.2 react-i18next@17.0.16 date-fns@4.4.0 react-native-gifted-charts@1.4.81

npm install -D drizzle-kit@0.31.11 babel-plugin-inline-import@3.0.0 jest-expo@~57.0.5 jest@~29.7.0 @types/jest@~29.5.14 @testing-library/react-native@14.0.1 test-renderer@1.3.0 vitest@5.0.3 prettier@3.9.9

npx expo lint               # configura eslint ^9 + eslint-config-expo (flat config) alla prima esecuzione
npx expo install --check    # deve segnalare 0 pacchetti incompatibili
npx expo-doctor             # controllo generale del progetto
```

Esperimento facoltativo (spike BLE, sezione 12): `npm install react-native-ble-plx@3.5.1 patch-package` in un ramo separato, mai insieme a ble-manager nel build di produzione.

**Configurazione da aggiungere (verificata sui sorgenti dei pacchetti):**

`babel.config.js` e `metro.config.js` (da `npx expo customize babel.config.js metro.config.js`):
```js
// babel.config.js
module.exports = function (api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'], plugins: [['inline-import', { extensions: ['.sql'] }]] };
};

// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
config.resolver.sourceExts.push('sql');          // migrazioni Drizzle
config.resolver.assetExts.push('wasm');          // expo-sqlite su web (alpha)
config.transformer.assetPlugins = ['expo-asset/tools/hashAssetFiles'];
module.exports = config;
```
`drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit';
export default defineConfig({ schema: './src/data/db/schema', out: './drizzle', dialect: 'sqlite', driver: 'expo' });
```
`app.json` -> `expo.plugins` (oltre a `expo-router` e `expo-splash-screen` gia' presenti):
```json
["react-native-ble-manager", { "bluetoothAlwaysPermission": "AutoGarage usa il Bluetooth per leggere i dati dall'adattatore OBD-II dell'auto.", "neverForLocation": true, "isBleRequired": false }],
["expo-notifications", { "defaultChannel": "scadenze" }],
"expo-sqlite"
```
e `expo.ios.infoPlist.NSLocalNetworkUsageDescription` quando si abilita il Wi-Fi. NON aggiungere `UIBackgroundModes` ne' `SCHEDULE_EXACT_ALARM` in MVP. Per le opzioni di `expo-notifications` verificate: `icon`, `color`, `defaultChannel`, `sounds`; per gli altri plugin (`expo-image-picker`, `expo-local-authentication`, `expo-secure-store`...) aggiungere le stringhe di permesso solo quando `npx expo-doctor` / la build le richiede (opzioni non verificate in questa ricerca).

`eas.json` (generato da `eas build:configure`; struttura standard, confidenza media sui valori esatti):
```json
{
  "cli": { "version": ">= 16.0.0", "appVersionSource": "remote" },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal", "android": { "buildType": "apk" } },
    "preview":     { "distribution": "internal", "android": { "buildType": "apk" } },
    "production":  { "autoIncrement": true }
  },
  "submit": { "production": {} }
}
```

## 10. Struttura di cartelle consigliata (expo-router)

Il template SDK 57 usa `src/app` per le rotte (verificato). Regola: **le schermate in `src/app` sono sottili** (solo composizione e navigazione); la logica sta in `src/features`, `src/domain`, `src/obd`, `src/data`, cosi' puo' essere testata con vitest su Node senza React Native.

```
AutoGarage/
  docs/research/                 # ricerche (features.md, obd.md, stack.md)
  mobile/
    app.json  eas.json  babel.config.js  metro.config.js  drizzle.config.ts
    eslint.config.js  jest.config.js  vitest.config.ts  tsconfig.json
    assets/
    drizzle/                     # migrazioni generate da drizzle-kit (SQL + migrations.js)
    e2e/                         # flussi Maestro (.yaml)
    src/
      app/                       # SOLO routing (expo-router, typedRoutes)
        _layout.tsx              # provider radice: DB+migrazioni, i18n, tema, handler notifiche
        (tabs)/_layout.tsx
        (tabs)/index.tsx         # Garage: elenco auto
        (tabs)/scadenze.tsx      # prossime scadenze (calcolate dal DB)
        (tabs)/storico.tsx       # interventi, rifornimenti, spese
        (tabs)/impostazioni.tsx  # lingua, backup, notifiche, adattatori
        auto/nuova.tsx           # form (modale)
        auto/[id]/index.tsx      # scheda auto
        auto/[id]/obd.tsx        # connessione e lettura OBD
        +not-found.tsx
      features/                  # per funzione: components/ hooks/ schema.ts (zod) per
        vehicles/ maintenance/ insurance/ deadlines/ fuel/ documents/ obd/ backup/ settings/
      domain/                    # TypeScript PURO (vitest): calcolo scadenze, intervalli tagliando, unita' di misura
      data/
        db/ (client.ts, schema/*.ts, migrate.ts)
        repositories/            # accesso ai dati; stessa interfaccia per SQLite e per la versione in-memory (web/test)
      obd/
        transport/               # ObdTransport.ts (interfaccia) + BleManagerTransport.ts, BlePlxTransport.ts (spike),
                                 # ClassicSppTransport.android.ts, TcpTransport.ts, MockTransport.ts
        elm327/                  # comandi AT, parser risposte, decodifica PID/DTC (TS puro, vitest)
        session/                 # macchina a stati: scansione -> connessione -> init -> lettura -> disconnessione
      notifications/             # reminder-scheduler.ts (finestra mobile), channels.ts, permissions.ts, background-task.ts
      i18n/                      # index.ts, locales/it.json (default), locales/en.json
      components/ui/             # componenti base
      hooks/  constants/  lib/   # utilita' (date-fns con locale it, formattatori, logger)
```
Convenzioni: file `*.web.ts(x)` / `*.android.ts(x)` / `*.ios.ts(x)` per codice specifico (il template usa gia' `app-tabs.web.tsx`); un `createTransport(kind)` sceglie `MockTransport` su web e in Expo Go, il trasporto reale nelle development build; `typedRoutes` e `reactCompiler` restano attivi come nel template.

## 11. Sviluppo su Windows senza Android SDK (web + Expo Go + OBD mock)

Prerequisiti verificati: Node **24.19.0** installato soddisfa `engines` di `react-native@0.86.3` (`^20.19.4 || ^22.13.0 || ^24.3.0 || >=25.0.0`); npm 11.17.0. Non servono Java, Android SDK ne' Xcode per i tre livelli seguenti.

| Livello | Comando | Cosa si puo' provare | Cosa NON si puo' provare | Confidenza |
|---|---|---|---|---|
| 1. Test di logica su Node | `npx vitest` (TS puro) e `npx jest` (componenti con `jest-expo` + RNTL) | parser ELM327/PID/DTC, calcolo scadenze, scheduler dei promemoria (con data finta), validazione zod, repository | rendering reale, BLE, notifiche di sistema | alta |
| 2. Anteprima web | `npx expo start --web` (Metro + `react-native-web ~0.21`) con `MockTransport` | tutta l'interfaccia, navigazione, form, grafici (gifted-charts via SVG), i18n. Dati: vedi nota SQLite web | BLE, notifiche locali, permessi, biometria, SecureStore nativo | alta (web), media (singole librerie) |
| 3. Expo Go su telefono reale (PC come server Metro) | `npx expo login` poi `npx expo start`, scansione del QR dal telefono sulla stessa rete | UI nativa vera, `expo-sqlite`, notifiche locali, file system, selettori file/foto, biometria, back-up/condivisione | tutto cio' che richiede moduli nativi extra: `react-native-ble-manager`, `react-native-tcp-socket`, Classic | alta |
| 4. Development build via EAS (cloud) | vedi sezione 12 | BLE reale, TCP reale, tutto | - | alta |

Dettagli e vincoli:
- **Adattatore OBD simulato.** `MockTransport` implementa la stessa interfaccia `ObdTransport` e risponde come un ELM327 (`ATZ`, `ATE0`, `ATSP0`, `0100`, `010C`, `010D`, `0105`, `03`, `0902`...), con scenari configurabili (latenza, `NO DATA`, `UNABLE TO CONNECT`, disconnessione, DTC). Selezione automatica: web, Expo Go (`Constants.executionEnvironment === ExecutionEnvironment.StoreClient` da `expo-constants`; confidenza media sul nome esatto dell'enum, non riletto in questa run) o variabile `EXPO_PUBLIC_OBD_MOCK=1`. Il modulo del trasporto reale va caricato con `require` dinamico dentro la factory, cosi' Expo Go e web non tentano di importare moduli nativi assenti.
- **Expo Go: login.** Dal 3 settembre 2026 l'esecuzione in Expo Go richiede lo stesso account loggato nel terminale (`npx expo login`) e nell'app; oggi vale per la versione iOS, per Android "in futuro" (ora raccomandato ma non obbligatorio); non serve per development build ne' simulatori. **[CORRETTO dalla verifica]** Expo Go per SDK 57 e' confermato solo sull'App Store iOS ("recently updated", post del 3 settembre 2026); per Google Play e' [DA VERIFICARE]. Inoltre la documentazione ufficiale ribadisce che Expo Go e' "a playground app", non adatta ad app di produzione, e che le development build "support custom native modules" (https://docs.expo.dev/get-started/set-up-your-environment/). Prima dell'uscita di SDK 58 stabile non e' noto se lo Expo Go degli store restera' allineato (a maggio 2026 sugli store c'era ancora SDK 54: confidenza alta sul ritardo storico). Fonti: https://expo.dev/changelog/expo-go-57-login ; https://expo.dev/changelog/expo-go-and-app-store-may-2026.md
- **SQLite su web e' alpha.** Richiede `wasm` in Metro (snippet nella sezione 9) e gli header `Cross-Origin-Embedder-Policy: credentialless` + `Cross-Origin-Opener-Policy: same-origin`; la documentazione mostra come impostarli per EAS Hosting (opzione `headers` del plugin `expo-router` in `app.json`) ma **non** per il dev server `expo start --web`: se il DB non si apre in anteprima, usare il fallback (repository in-memory con gli stessi dati di seed) oppure `Platform.OS === 'web'` -> repository in-memory. Fonte: https://docs.expo.dev/versions/v57.0.0/sdk/sqlite.md . Confidenza: alta sui requisiti, **bassa** sul comportamento in dev su Windows (da provare nello spike).
- **Test dei repository Drizzle su Node (idea, non provata):** `drizzle-orm` ha tra i peer `sql.js >=1` (driver WASM, nessuna compilazione nativa su Windows), quindi le query potrebbero essere eseguite in `vitest` contro `sql.js` con lo stesso schema `sqlite-core`. Da verificare in uno spike (confidenza bassa).
- **Maestro (opzionale).** Maestro CLI 2.11.0 su Windows richiede Java 17+ e, per Android, un dispositivo/emulatore raggiungibile con `adb`; l'iOS non e' coperto sotto Windows. Non e' "Android SDK completo": basterebbero le sole platform-tools (adb) con un telefono in debug USB, ma e' un'installazione in piu' rispetto ai vincoli dichiarati: rimandare Maestro a dopo l'MVP. Fonte: https://docs.maestro.dev/getting-started/installing-maestro/windows
- **Emulatore Android:** non disponibile senza Android SDK; non necessario con i livelli 1-4.

## 12. Provare il BLE reale (dev build EAS / dispositivo)

**Android (nessun costo oltre al piano gratuito di EAS):**
```powershell
npm install --global eas-cli          # oppure: npx eas-cli@latest <comando>   (eas-cli 24.11.0)
eas login
eas build:configure                   # crea/aggiorna eas.json
eas build --platform android --profile development    # APK con expo-dev-client, compilato nel cloud
# installare l'APK sul telefono dal link/QR mostrato (abilitare "installa da origini sconosciute" per il browser usato)
npx expo start --dev-client           # il PC fa da server Metro; la dev build si collega via LAN
```
Ogni modifica al codice JS/TS si vede subito (Fast Refresh) senza ricompilare; **ricompilare solo se cambiano pacchetti nativi o `app.json`/plugin**. Piano gratuito EAS: 15 build Android + 15 iOS al mese, coda a bassa priorita', concorrenza 1 (https://expo.dev/pricing, letto il 2026-10-07). Fonte per la procedura: https://docs.expo.dev/develop/development-builds/introduction/

**iOS:** build di sviluppo per un iPhone fisico richiede un **account Apple Developer a pagamento** (registrazione del dispositivo, distribuzione interna ad hoc); i simulatori iOS esistono solo su macOS e comunque non hanno Bluetooth reale. Quindi: sviluppare e testare il BLE prima su Android; per iOS pianificare l'account (99 USD/anno) e un iPhone dedicato ai test. Fonte: stessa pagina Expo. Il flusso dei certificati via `eas credentials` da Windows e' normale per EAS (confidenza media, non riletto in questa run).

**Checklist dello spike BLE (da eseguire prima di congelare la scelta della libreria):**
1. Dev build con `react-native-ble-manager` 12.5.3 su un telefono Android 12+ e uno 8-11 (permessi diversi), con un ELM327 BLE reale: scansione, connessione, `retrieveServices`, notifica sulla caratteristica, scrittura senza risposta (`ATZ`, `ATE0`, `0100`), lettura continua 10 min, spegnimento adattatore, riconnessione.
2. Stesso test su iPhone (account a pagamento) in build *release* (il problema noto #1278 di ble-plx compare solo in release).
3. Ripetere con `react-native-ble-plx` 3.5.1 (+ patch iOS) per confronto; scegliere in base a stabilita', non alla popolarita'.
4. Provare `react-native-bluetooth-classic` 1.73.0-rc.17 su Android con un ELM327 Classic (accoppiamento nelle impostazioni di sistema, SPP UUID `00001101-0000-1000-8000-00805F9B34FB`).
5. Verificare il comportamento con schermo spento e app in background (atteso: connessione persa; accettabile in MVP).
6. Annotare MTU e framing: gli ELM327 BLE spezzano le risposte in piu' notifiche; accumulare fino al prompt `>`.

## 13. Prerequisiti di distribuzione e costi

| Voce | Costo | Requisiti | Note | Confidenza / fonte |
|---|---|---|---|---|
| Expo / EAS Free | 0 USD | account Expo | 15 build Android + 15 iOS al mese, coda a bassa priorita', concorrenza 1; EAS Submit disponibile; EAS Update 1.000 utenti attivi/mese | alta - https://expo.dev/pricing |
| EAS Starter (se serve) | 19 USD/mese | - | 45 USD di crediti build; pay-as-you-go: build Android medium 1 USD, iOS medium 2 USD | alta - https://expo.dev/pricing |
| Google Play Console | **25 USD una tantum** | documento d'identita' + carta a nome legale; account Personale oppure Organizzazione; account personali nuovi: periodo di closed testing prima della produzione (**[CORRETTO dalla verifica]** 12 tester x 14 giorni ininterrotti: confermato dalla pagina ufficiale https://support.google.com/googleplay/android-developer/answer/14151465) | build di produzione = AAB (`eas build --platform android --profile production`); `eas submit` richiede una chiave di servizio Google (prima pubblicazione di solito manuale da console: confidenza media, non riletto) | alta (costo) - https://support.google.com/googleplay/android-developer/answer/6112435 ; **alta** (12 tester x 14 giorni, pagina ufficiale 14151465) |
| Test interno Android | 0 | - | APK `preview` via link EAS ("distribuzione interna") senza passare da Play; il track "Internal testing" di Play richiede l'app creata in console (numero tester non riletto: confidenza media) | media |
| Apple Developer Program | **99 USD / anno** (in Italia l'importo in euro e' mostrato in fase di iscrizione) | Apple Account con 2FA, nome legale, maggiore eta'; organizzazione: D-U-N-S, sito web, autorita' legale | necessario per build su iPhone fisico, TestFlight, App Store | alta - https://developer.apple.com/programs/enroll/ |
| TestFlight | incluso | - | interni fino a 100, esterni fino a 10.000, build valide 90 giorni; la prima build esterna passa da Beta App Review | alta - https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/ |
| Mac | non richiesto | - | le build iOS si fanno nel cloud EAS; il Mac servirebbe solo per simulatore/Xcode locale | media |
| Dichiarazioni Play | - | pagina "Contenuti dell'app": sicurezza dei dati, privacy policy URL, tipi di FGS (se usati) | privacy policy necessaria in entrambi gli store (l'app tratta targa/VIN/dati personali: conferma da documenti non riletta) | media |
| Costo minimo primo anno | circa 25 + 99 = **124 USD** (solo Play: 25 USD) | - | EAS Free puo' bastare per un singolo sviluppatore con pochi rilasci | stima |

Ordine consigliato: (1) sviluppo gratuito su Android con dev build; (2) acquistare Play Console quando l'MVP e' pronto per il closed testing (parte il conto dei 14 giorni se account personale); (3) Apple Developer solo quando si vuole provare/rilasciare su iPhone.

## 14. Lacune e confidenza bassa

Budget web usato: 34 chiamate WebSearch/WebFetch su 35 (piu' interrogazioni a registri npm/pub.dev/GitHub API via `npm view`, `npm pack`, `curl`, che servono a ricavare versioni e a leggere il codice dei pacchetti).

**Non verificato in esecuzione (serve uno spike su hardware reale):**
1. Funzionamento di `react-native-ble-manager` 12.5.3 e `react-native-ble-plx` 3.5.1 con RN 0.86.3 su Android e iOS con un ELM327 BLE reale (la scelta della libreria primaria e' basata su manutenzione, architettura nativa e issue pubbliche, non su prove). **Confidenza media.**
2. `react-native-bluetooth-classic` 1.73.0-rc.17 su RN 0.86 (modulo legacy, RC): **confidenza bassa.**
3. `expo-sqlite` su web (alpha): non e' noto come impostare gli header COOP/COEP nel dev server `expo start --web` su Windows; fallback previsto: repository in-memory. **Confidenza bassa.**
4. Idea di testare Drizzle su Node con `sql.js` in vitest: non provata. **Confidenza bassa.**
5. Sintassi `create-expo-app ... --template default@sdk-57`: **[CORRETTO dalla verifica]** confermata nel sorgente di `create-expo@5.0.3` (vedi sez. 9; la doc ufficiale non la descrive). Resta non verificato il comportamento di `create-expo-app` in cartelle non vuote: si scaffolda in sottocartella `mobile` per evitarlo. **Confidenza alta (sintassi), media (cartella non vuota).**
6. `npx expo install --check` e `npx expo-doctor` non eseguiti (richiedono un progetto): la compatibilita' e' stata derivata da `bundledNativeModules.json` di `expo@57.0.27` e da un `npm install --package-lock-only` senza conflitti. **Confidenza alta sulla risoluzione delle dipendenze, nessuna sulla build nativa.**

**Fonti non ufficiali o parziali:**
7. **[CORRETTO dalla verifica]** Requisito Play "12 tester per 14 giorni" per account personali: NON piu' solo blog; e' scritto nella pagina ufficiale https://support.google.com/googleplay/android-developer/answer/14151465 (12 tester iscritti ininterrottamente per almeno 14 giorni, closed test obbligatorio). **Confidenza alta.**
8. Limite iOS di 64 notifiche pendenti: riportato da forum Apple (thread 811171, 106829) e non da una pagina di documentazione ufficiale. **Confidenza alta sul limite, media sulla fonte.**
9. Il fork `@sfourdrinier/react-native-ble-plx` e' descritto dal proprio FORK.md ("upstream effectively unmaintained"): giudizio dell'autore del fork, non verificato in modo indipendente; verificati solo versioni, date, licenza MIT, download. **Confidenza media.**
10. Documento Apple su Core Bluetooth in background: pagina **archiviata** (2013); i dettagli su iOS recenti (es. state restoration su iOS 26, issue #1386 di ble-manager) non sono stati verificati.

**Non ricercato per budget:**
11. Regole dettagliate di App Review sull'uso del Bluetooth/background modes e sulla privacy (etichette privacy, privacy policy, export compliance/crittografia); modulo "Contenuti dell'app" di Play (Data safety). Da verificare prima della pubblicazione.
12. Comportamento reale dei produttori Android (Xiaomi, Huawei, Samsung, ecc.) su alarm e notifiche in background.
13. Procedura esatta di `eas submit` per la prima pubblicazione su Play (chiave di servizio, primo upload manuale) e limiti dei track di test Play (interno/chiuso).
14. Build iOS da Windows con `eas credentials` (gestione certificati con account Apple): ragionevole ma non riletto.
15. Alternative di build per Flutter senza SDK locale (es. servizi CI) e supporto Classic SPP in Flutter: non esaminati.
16. Data di uscita stabile di SDK 58 (l'unico indizio: SDK 54 riceve fix critici "until the next SDK release (September or October 2026)"); piano: restare su SDK 57 per l'MVP e migrare con `npx expo install expo@^58 --fix` dopo la stabile. [Verifica 2026-10-07: il changelog Expo mostra, come ultima voce rilevante, "Expo SDK 58 Beta" del 15 settembre 2026; nessuna uscita stabile di SDK 58 al 7 ottobre 2026; il dist-tag `latest` di `expo` e' ancora 57.0.27.]

## Esito verifica

Verifica scettica indipendente eseguita il 2026-10-07 (budget: 25 chiamate WebSearch/WebFetch, piu' interrogazioni a registro npm, API GitHub, API pub.dev, ispezione locale dei tarball `npm pack` di `expo@57.0.27`, `expo-template-default@57.0.29`, `expo-notifications@57.0.22`, `expo-modules-core@57.0.21`, `react-native-ble-manager@12.5.3`, `react-native-ble-plx@3.5.1`, `react-native-bluetooth-classic@1.73.0-rc.17`, `react-native-tcp-socket@6.4.3`, `create-expo@5.0.3`, `@expo/cli@57.0.28`). Risultato complessivo: **la conclusione centrale del ricercatore regge** (Expo SDK 57 + RN 0.86.3 + dev build EAS; BLE dietro `ObdTransport`; `react-native-ble-manager` primaria; Classic opzionale e di bassa confidenza; spike su dispositivo obbligatorio). **Nessuna affermazione centrale e' stata smentita**; sono stati trovati 12 punti imprecisi/da correggere (corretti in linea con [CORRETTO dalla verifica]), 9 punti non verificabili ([DA VERIFICARE]) e 7 fatti importanti omessi.

### Confermato (verificato su fonte primaria o sul codice)
1. SDK Expo: `expo@57.0.27` e' `latest`; SDK 57 rilasciato il 30 giugno 2026 (https://expo.dev/changelog/sdk-57); SDK 58 in beta dal 15 settembre 2026 (https://expo.dev/changelog; `npm view expo dist-tags`: `next` = 58.0.6); nessuna stabile 58 al 7 ottobre 2026.
2. RN 0.86.3, React 19.2.3, react-native-web ~0.21.0, expo-router ~57.0.25: letti in `bundledNativeModules.json` di `expo@57.0.27`; confermato che le ultime su npm sono piu' nuove e NON vanno usate (react-native 0.87.1, react 19.3.0, gesture-handler 3.3.0, reanimated 4.7.1, worklets 0.13.0, screens 4.28.0, safe-area-context 5.10.1, flash-list 2.3.3, typescript 7.0.2, jest 30.5.2, eslint 10.12.0).
3. Tutte le 39 versioni "da usare" Expo/native elencate in sez. 7 coincidono con `bundledNativeModules.json` (0 discrepanze); le versioni "libere" (zustand 5.0.15, zod 4.6.5, i18next 26.4.2, react-i18next 17.0.16, date-fns 4.4.0, vitest 5.0.3, prettier 3.9.9, react-hook-form 7.89.0, @hookform/resolvers 5.9.1, eas-cli 24.11.0, create-expo-app 5.0.0, ble-manager 12.5.3, ble-plx 3.5.1, bluetooth-classic 1.73.0-rc.17, tcp-socket 6.4.3, drizzle-orm 0.45.3 `latest`, drizzle-kit 0.31.11 `latest`) coincidono con `npm view`.
4. Template `expo-template-default@57.0.29`: `src/app`, `experiments.typedRoutes` e `experiments.reactCompiler` true, script `reset-project`, dipendenze con RN 0.86.3 / React 19.2.3 / TypeScript ~6.0.3, nessun `expo-dev-client` (va aggiunto); Node 24.19.0 soddisfa `engines` di RN 0.86.3 (`^24.3.0`).
5. `react-native-ble-plx` 3.5.1: ultima release 2026-02-18, modulo legacy a bridge (`BlePlxModule.java` / `RCT_EXPORT_METHOD`, nessun `codegenConfig`), config plugin Expo presente con le opzioni citate; issue #1277, #1278, #1323 ancora aperte; ~239.746 download/sett.
6. `react-native-ble-manager` 12.5.3: release 12.4.5 (2026-03-19), 12.5.0 (05-28), 12.5.1 (07-06), 12.5.2 (09-07), 12.5.3 (09-21); `codegenConfig` `BleManagerSpec` (TurboModule); README: "RN 0.76+ only the new architecture is supported"; 7 issue aperte non-PR; issue #1439, #1438, #1411, #1386 aperte; licenza Apache-2.0; ~132.849 download/sett.
7. `react-native-bluetooth-classic`: `latest` = 1.73.0-rc.17 (2025-11-19) = release candidate; modulo legacy (`RNBluetoothClassicModule.java`), nessun config plugin; ultimo commit 2025-11-19; ~22.502 download/sett.; `with-rn-bluetooth-classic@1.0.5` e' del 2022; iOS = External Accessory/MFi (README del pacchetto).
8. Fork `@sfourdrinier/react-native-ble-plx` 3.9.3 (2026-07-28, MIT, ~2.636 download/sett., richiede RN >= 0.86 / Expo SDK 57+ secondo il suo FORK/ROADMAP): adozione bassa confermata.
9. New Architecture obbligatoria da RN 0.82 (`newArchEnabled=false` ignorato) e layer di interop mantenuti "for the foreseeable future": https://reactnative.dev/blog/2025/10/08/react-native-0.82 .
10. Expo Go: login obbligatorio dal 3 settembre 2026 solo su iOS (Android "in the future"); non richiesto per development build ne' simulatori (https://expo.dev/changelog/expo-go-57-login); Expo Go "playground app", le dev build supportano moduli nativi custom (https://docs.expo.dev/get-started/set-up-your-environment/); push remoto non disponibile in Expo Go su Android da SDK 53, notifiche locali disponibili (https://docs.expo.dev/versions/latest/sdk/notifications/); SDK 54 riceve fix critici fino alla prossima uscita (settembre/ottobre 2026).
11. Limite iOS di 64 notifiche locali pendenti (le piu' vicine nel tempo): confermato dai thread Apple Developer Forums 811171, 106829 (non da documentazione ufficiale).
12. `expo-notifications@57.0.22` (sorgente): `setExactAndAllowWhileIdle` se Android < 12 o `canScheduleExactAlarms()`, altrimenti `setAndAllowWhileIdle` (`ExpoSchedulingDelegate.kt` righe 106-114); il manifest dichiara `RECEIVE_BOOT_COMPLETED` e `POST_NOTIFICATIONS` ma NON `SCHEDULE_EXACT_ALARM`; receiver su `BOOT_COMPLETED`, `REBOOT`, `QUICKBOOT_POWERON`, `MY_PACKAGE_REPLACED`. La doc Expo dice che per orario esatto su Android 12+ serve aggiungere `SCHEDULE_EXACT_ALARM`. Tabella trigger per piattaforma (DATE/TIME_INTERVAL/DAILY: entrambe; WEEKLY/MONTHLY/YEARLY: Android; CALENDAR: iOS) e opzioni del plugin (`icon`, `color`, `defaultChannel`, `sounds`, `enableBackgroundRemoteNotifications`) confermate.
13. Google Play: target API 36 per nuove app/aggiornamenti dal 31 agosto 2026 (estensione richiedibile fino al 1 novembre 2026), app esistenti almeno API 35 (https://support.google.com/googleplay/android-developer/answer/11926878); permessi Bluetooth Android 12+ (`BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, `neverForLocation`, legacy `maxSdkVersion=30`, posizione fino ad Android 11) confermati su https://developer.android.com/develop/connectivity/bluetooth/bt-permissions ; FGS `connectedDevice` con `FOREGROUND_SERVICE_CONNECTED_DEVICE`, nessun timeout, dichiarazione dei tipi in Play Console "App content" per target >= 14 confermati su https://developer.android.com/develop/background-work/services/fgs/service-types .
14. Costi: Play Console 25 USD una tantum (https://support.google.com/googleplay/android-developer/answer/6112435); Apple Developer Program 99 USD/anno, prezzo in valuta locale in fase di iscrizione, individuale: nome legale / organizzazione: D-U-N-S + sito web + autorita' legale (https://developer.apple.com/programs/enroll/); EAS Free 0 USD con 15 build Android + 15 iOS, coda a bassa priorita', concorrenza 1, 1K MAU EAS Update, EAS Submit incluso; Starter 19 USD/mese con 45 USD di crediti; pay-as-you-go 1 USD (Android medium) / 2 USD (iOS medium) (https://expo.dev/pricing).
15. Valori di default SDK 57: `compileSdk` 36, `targetSdk` 36, `minSdk` 24 (`expo-modules-core@57.0.21`), iOS 16.4 (`Expo.podspec`).
16. Flutter: stable 3.47.6 (2026-10-01); `flutter_blue_plus` 2.3.14, `flutter_reactive_ble` 5.6.0, `drift` 2.35.1, `flutter_local_notifications` 22.3.1; licenza FlutterBluePlus 1.6 con licenza commerciale per organizzazioni a scopo di lucro (https://raw.githubusercontent.com/boskokg/flutter_blue_plus/master/LICENSE.md).
17. Test/lint: `jest-expo@57.0.5` dipende da `babel-jest`/`@jest/globals` ^29 (e `@react-native/jest-preset` dipende da `babel-jest`/`jest-environment-node` ^29.7.0) -> Jest 29 corretto; `@testing-library/react-native@14.0.1` ha peer `test-renderer ^1.0.0`; `expo lint` installa `eslint ^9.0.0` di default.

### Corretto (modificato in linea con [CORRETTO dalla verifica])
1. Requisito Play "12 tester per 14 giorni" (account personali creati dopo il 13/11/2023): il ricercatore lo dava con confidenza media da blog; la pagina UFFICIALE https://support.google.com/googleplay/android-developer/answer/14151465 lo riporta (closed test obbligatorio, 12 tester ininterrottamente per almeno 14 giorni) -> confidenza alta. Corretti sez. 6.1, 13 e 14 (punto 7).
2. Android "si possono pianificare tutte le notifiche (nessun limite documentato)": esiste un tetto di 500 alarm concorrenti per app (AOSP `MAX_ALARMS_PER_UID`); `expo-notifications` registra un alarm per notifica -> finestra mobile utile anche su Android (sez. 5.2, confidenza media, comportamento oltre il tetto non verificato per versione).
3. Expo Go per SDK 57: confermato solo l'App Store iOS ("recently updated" nel post del 3 settembre 2026); la disponibilita' su Google Play NON e' confermata -> [DA VERIFICARE]; la menzione di `eas go` appartiene al post di maggio 2026 (SDK 55 e 56, iOS, richiede Apple Developer Program), non a quello del login (sez. 3, 8 #9, 11).
4. `drizzle-orm`/`drizzle-kit`: il dist-tag `rc` e' **1.0.0-rc.4** (2026-06-27), non "1.0.0-rc.5": rc.5 esiste solo come snapshot con hash (`1.0.0-rc.5-5935859`, 2026-09-09, tag `rc5`). La raccomandazione (restare su 0.45.3 / 0.31.11, entrambe del 2026-09-21) resta valida (sez. 7.3).
5. Sintassi `create-expo-app ... --template default@sdk-57`: non e' descritta nella doc, ma e' confermata nel sorgente di `create-expo@5.0.3` (`getResolvedTemplateName`: alias `default` -> `expo-template-default`, tag passato a `npm pack`; `default@57` -> `@sdk-57`). Aggiornate sez. 9 e 14 (punto 5). `sdk-57` e `latest` del template = 57.0.29; esiste anche `sdk-58` = 58.0.15.
6. ESLint: "expo lint impone ^9" -> installa `^9.0.0` di default ma `lintAsync.js` accetta ESLint >= 8.57.0 e `eslint-config-expo` ha peer `eslint >=8.10`: il pin a 9 e' prudente, non un conflitto dimostrato (sez. 7.6 e 8 #4).
7. `react-native-ble-plx`: precisata l'inattivita' (ultimo commit su `master` 2026-03-09 con un fix post-3.5.1 mai rilasciato; 33 issue aperte; nessun dist-tag `next`) (sez. 4.1).
8. `react-native-ble-manager`: iOS 15.1+/Android API 23+ sono dal README; il podspec dichiara iOS 11.0 e il default Gradle `minSdkVersion` 24 (incoerenza solo di documentazione; irrilevante con SDK 57) (sez. 4.1).
9. `targetSdk` 36: il valore letto in `expo-modules-core` e' un fallback `safeExtGet`; il valore effettivo va controllato sul primo build EAS (sez. 6.1).
10. Limite 64 iOS: aggiunto che una richiesta con trigger ripetuto conta come una sola e che manca una pagina di documentazione ufficiale Apple/Expo (sez. 5.1).
11. Guideline App Review sul Bluetooth/background: riletta (2.5.4 elenca gli scopi ammessi; nessuna guideline numerata dedicata a Bluetooth/MFi; 5.1.1(i) privacy policy obbligatoria): da "non riletta, confidenza bassa" a letta (sez. 6.2).
12. Account Play: aggiunti requisiti letti nella pagina ufficiale (18+, documento d'identita' e carta a nome legale, verifica del dispositivo con l'app Play Console per i nuovi account personali) (sez. 6.1). Nota minore: `@react-native/jest-preset ^0.86.3` e' un **peer** (non una dipendenza) di `jest-expo@57.0.5`: npm >= 7 lo installa da solo, ma conviene aggiungerlo esplicitamente se `jest` non trova il preset.

### Smentito
Nessuna affermazione centrale smentita. L'unico dato materialmente errato (ma non decisivo) e' "drizzle `rc` = 1.0.0-rc.5" (vedi Corretto 4).

### Non verificabile / da verificare ([DA VERIFICARE])
1. Disponibilita' di Expo Go per SDK 57 su Google Play (Android): nessuna fonte la conferma; verificare sul telefono.
2. `NSLocalNetworkUsageDescription` per il trasporto Wi-Fi su iOS: regola nota ma nessuna fonte primaria letta ne' dal ricercatore ne' dalla verifica.
3. Immagine macOS/Xcode usata da EAS Build per SDK 57 (Apple richiede Xcode 26+ dal 2026-04-28).
4. `targetSdkVersion` effettivo dell'app generata (vedi Corretto 9).
5. Se l'installazione via `adb` e il sideload di APK EAS siano esentati dalla verifica sviluppatore Android (pagina primaria non esplicita) e se la verifica copra il sideload (pagina primaria: "apps from participating stores"; fonti secondarie: si').
6. Comportamento dei trigger ripetuti di `expo-notifications` su iOS rispetto al limite 64.
7. Funzionamento reale su RN 0.86 di `react-native-ble-manager`, `react-native-ble-plx` (+ interop), `react-native-bluetooth-classic` (RC, legacy) e `react-native-tcp-socket` (legacy): nessuna prova di esecuzione, ne' del ricercatore ne' nostra; l'issue #1278 di ble-plx (crash iOS release con `null`) e' ancora aperta; resta obbligatorio lo spike su dispositivo reale.
8. Comportamento esatto oltre i 500 alarm per le diverse versioni di Android.
9. Non ricontrollati dalla verifica (restano con la confidenza dichiarata dal ricercatore): limiti TestFlight (100 interni / 10.000 esterni / 90 giorni), esigenza dell'Android SDK per Flutter, procedura di `eas submit`, requisiti Maestro, header COOP/COEP di `expo-sqlite` su web, opzioni dei plugin diversi da BLE/notifiche, comportamento dei produttori Android su alarm in background, `expo-sqlite` web in alpha.

### Fatti importanti omessi dal ricercatore (ora integrati)
1. **Verifica sviluppatore Android**: dal 30 settembre 2026 in Brasile, Indonesia, Singapore, Thailandia (Android 7+ certificati) e globalmente nel 2027 le app devono provenire da sviluppatori verificati (Play Console oppure Android Developer Console); "limited distribution account" gratuito fino a 20 dispositivi per studenti/hobbisti; "advanced flow" per app non verificate. Impatta gli APK di distribuzione interna EAS in Italia dal 2027 (https://developer.android.com/developer-verification) - integrato in sez. 6.1.
2. **Apple**: dal 28 aprile 2026 i caricamenti su App Store Connect richiedono Xcode 26+ / SDK iOS 26 (https://developer.apple.com/news/upcoming-requirements/) - integrato in sez. 6.2.
3. **Licenza FlutterBluePlus**: oltre al requisito commerciale, "Build-Time License Ping" (telemetria di nome pacchetto, nome app, versione app, versione FBP, data) - integrato in sez. 2.
4. **Tetto Android di 500 alarm per app** - integrato in sez. 5.2.
5. **`react-native-tcp-socket` e' un modulo legacy a bridge** (gira via interop in RN 0.86) e non ha config plugin Expo - integrato in sez. 4.3.
6. **Requisiti account Play**: 18+, documento e carta a nome legale, verifica del dispositivo per i nuovi account personali - integrato in sez. 6.1.
7. **Notifiche iOS**: le richieste con trigger ripetuto contano come una sola nel limite 64; il dist-tag `sdk-58` del template (58.0.15) esiste gia' e `latest` passera' a SDK 58 alla stabile: fissare sempre il tag `sdk-57` (gia' previsto in sez. 9).

### Fonti consultate dalla verifica (nuove ricerche)
https://expo.dev/changelog ; https://expo.dev/changelog/sdk-57 ; https://expo.dev/changelog/expo-go-57-login ; https://expo.dev/changelog/expo-go-and-app-store-may-2026 ; https://expo.dev/pricing ; https://docs.expo.dev/get-started/set-up-your-environment/ ; https://docs.expo.dev/versions/latest/sdk/notifications/ ; https://docs.expo.dev/more/create-expo/ ; https://reactnative.dev/blog/2025/10/08/react-native-0.82 ; https://support.google.com/googleplay/android-developer/answer/11926878 ; https://support.google.com/googleplay/android-developer/answer/14151465 ; https://support.google.com/googleplay/android-developer/answer/6112435 ; https://developer.android.com/developer-verification ; https://developer.android.com/develop/connectivity/bluetooth/bt-permissions ; https://developer.android.com/develop/background-work/services/fgs/service-types ; https://developer.apple.com/programs/enroll/ ; https://developer.apple.com/news/upcoming-requirements/ ; https://developer.apple.com/app-store/review/guidelines/ ; https://developer.apple.com/forums/thread/811171 ; https://android.googlesource.com/platform/frameworks/base/+/87fd50612963 ; https://raw.githubusercontent.com/boskokg/flutter_blue_plus/master/LICENSE.md ; API GitHub (dotintent/react-native-ble-plx, innoveit/react-native-ble-manager, kenjdavidson/react-native-bluetooth-classic, Rapsssito/react-native-tcp-socket) ; registro npm (`npm view`, `npm pack`) e API download npm del 2026-10-07 ; pub.dev API ; releases JSON Flutter.
