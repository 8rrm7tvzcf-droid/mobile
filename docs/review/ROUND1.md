# Revisione del codice - giro 1 (13 ottobre 2026)

Revisori scettici per area (scadenze, regole italiane, dati/backup, OBD). Ogni finding ha una prova di riproduzione in mobile/tests/review/ che FALLISCE finche' il bug esiste (config: mobile/vitest.review.config.mts). Dettagli completi in round1-findings.json.

| ID | Gravita | Titolo | Prova |
|---|---|---|---|
| ITALY-1 | high | Bollo: dopo il primo pagamento 'spostato' il rinnovo successivo cade un mese in ritardo | si |
| DL-1 | high | Annulla di un Fatto con km non rimuove la lettura del contachilometri creata dal Fatto | si |
| DATA-1 | high | Import 'Unisci' duplica o fa risorgere le righe figlie senza cancellazione morbida (righe intervento, garanzie) | si |
| obd-01 | high | Il blocco anti-scrittura lascia passare Mode 04 con cifra finale ('041'), AT PP e servizi KWP di controllo | si |
| DL-2 | medium | Le schermate (Oggi, scadenze auto, dettaglio) ignorano le impostazioni forecast.* usate da riconciliazione e notifiche | si |
| DL-3 | medium | 'Salta' su una voce dall'ultimo fatto non cambia semafori e 'Prossima scadenza': la voce risulta ancora scaduta | si |
| DATA-2 | medium | 'Elimina definitivamente' un'auto dal Cestino lascia i file degli allegati su disco fino al riavvio | si |
| DATA-3 | medium | La copia di sicurezza pre-importazione non e' ripristinabile: manca 'Annulla importazione' | solo codice |
| DATA-4 | medium | restoreFuelLog riesuma anche i km che l'utente aveva tolto a mano prima di eliminare il rifornimento | si |
| obd-02 | medium | Il report di capacita' viene falsato da errori di comunicazione e messo in cache per tutta la connessione | si |
| obd-03 | medium | LV RESET / ERR94 a meta' sessione: nessun init di recupero, tutte le letture falliscono ma lo stato resta 'ready' | si |
| obd-04 | medium | Stati di connessione incoerenti: la facade resta in 'reconnecting' se l'init post-riconnessione fallisce; ObdConnection va da 'closed' a 'failed' | si |
| obd-05 | medium | BleTransport.close() durante una (ri)connessione non la annulla: il link resta collegato con i listener riattaccati; chiusure definitive non rilasciano i listener | si |
| ITALY-2 | low | Bollo con mese di pagamento febbraio: in anno bisestile la serie propone il 28/02 invece del 29/02 | si |
| DL-4 | low | Dopo Salta + Fatto + Annulla il ciclo saltato risorge come promemoria aperto | si |
| DL-5 | low | Notifica di scadenza per km gia' raggiunti dice 'probabilmente scaduto' (stima) invece di 'scaduto' | si |
| DL-6 | low | Lo snooze attraversa il cambio dell'ora legale con uno scarto di un'ora (fine snooze anticipata alle 08:00) | si |
| DATA-5 | low | Il tetto di dimensione dello ZIP (2 GB) si controlla dopo aver decompresso tutto in memoria: zip bomb | si |
| DATA-6 | low | I documenti allegati a un intervento, rifornimento, spesa o polizza nel cestino restano visibili in 'Documenti' | si |
| obd-06 | low | Un errore transitorio sul primo 0100 (BUS BUSY, DATA ERROR, STOPPED, BUFFER FULL) fa fallire l'init con un messaggio fuorviante | si |
