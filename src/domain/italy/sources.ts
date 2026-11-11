// Fonti delle regole (URL da REG, SPEC §7) e data di verifica comune. Dominio puro: solo dati.
import type { LocalDate, RuleSource } from './types';

/** Data della verifica scettica indipendente di REG (2026-10-07). Rileggere le fonti ogni 6 mesi e prima di ogni rilascio. */
export const VERIFIED_ON: LocalDate = '2026-10-07';

/** Controlli puntuali previsti dalla SPEC: conversione del D.L. 162/2026 e adeguamento ISTAT degli importi. */
export const RECHECK_AFTER: readonly { readonly on: LocalDate; readonly reason: string }[] = [
  { on: '2026-11-16', reason: 'Termine di conversione del D.L. 162/2026 (esenzione bollo 2027)' },
  { on: '2026-12-01', reason: 'Adeguamento biennale ISTAT degli importi delle sanzioni (art. 195 c.3 CdS)' },
];

const s = (label: string, url: string): RuleSource => ({ label, url });

export const SOURCES = {
  normattiva_cds: s(
    'Normattiva: D.Lgs. 285/1992 (Codice della Strada)',
    'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:1992-04-30;285',
  ),
  mit_revisioni: s('MIT: revisione dei veicoli', 'https://www.mit.gov.it/node/2789'),
  portale_revisioni: s(
    "Portale dell'Automobilista: revisioni",
    'https://www.ilportaledellautomobilista.it/web/portale-automobilista/veicoli/revisioni',
  ),
  aci_art80: s('ACI: art. 80 CdS', 'https://aci.gov.it/codice-della-strada/art-80/'),
  aci_revisione: s(
    'ACI: revisione auto, costi, scadenze e novita',
    'https://www.lautomobile.aci.it/come-fare-per/revisione-auto-2024-2025-costi-scadenze-e-novita/',
  ),
  alvolante_revisione_ue: s(
    'Al Volante: no del Consiglio UE alla revisione annuale',
    'https://www.alvolante.it/news/no-del-consiglio-ue-alla-revisione-annuale-delle-auto-409751',
  ),
  aci_bollo_guida: s(
    'ACI: bollo auto 2026, scadenze, tariffe ed esenzioni',
    'https://www.lautomobile.aci.it/attualita/bollo-auto-2026-scadenze-tariffe-ed-esenzioni-la-guida-completa/',
  ),
  aci_bollo_2028: s(
    'ACI: bollo auto, tutte le novita dal 2026 al 2028',
    'https://www.lautomobile.aci.it/attualita/bollo-auto-tutte-le-novita-dal-2026-al-2028/',
  ),
  aci_addio_bollo: s('ACI: addio al bollo auto (D.L. 162/2026)', 'https://www.lautomobile.aci.it/attualita/addio-al-bollo-auto/'),
  informazione_fiscale_bollo: s(
    'Informazione Fiscale: bollo auto, novita e scadenze',
    'https://www.informazionefiscale.it/bollo-auto-novita-scadenze-obblighi-controlli',
  ),
  aci_calcolo_bollo: s('ACI: calcolo del bollo', 'https://online.aci.it/acinet/calcolobollo/index.asp'),
  ivass_rca: s('IVASS: RC auto', 'https://www.ivass.it/consumatori/quesiti/r.c.auto/index.html'),
  aci_art193: s('ACI: art. 193 CdS', 'https://aci.gov.it/codice-della-strada/art-193/'),
  portale_rca_tacito: s(
    "Portale dell'Automobilista: RC auto, mai piu rinnovo tacito",
    'https://www.ilportaledellautomobilista.it/web/portale-automobilista/-/rc-auto-mai-piu-rinnovo-tacito',
  ),
  sicurauto_tolleranza_rca: s(
    'Sicurauto: RC auto, tolleranza di 15 giorni',
    'https://www.sicurauto.it/news/codice-della-strada/rc-auto-dal-1-agosto-il-periodo-di-tolleranza-torna-di-15-giorni/',
  ),
  aci_gomme_invernali: s(
    'ACI: gomme invernali 2026',
    'https://www.lautomobile.aci.it/attualita/gomme-invernali-2026-dal-15-ottobre-si-possono-montare-obbligo-date-e-multe/',
  ),
  polizia_gomme: s(
    'Polizia di Stato: pneumatici invernali',
    'https://www.poliziadistato.it/articolo/dal-15-novembre-scatta-l-obbligo-degli-pneumatici-invernali',
  ),
  federmetano_bombole: s('Federmetano: revisione bombole metano', 'https://www.federmetano.it/revisione-bombole-metano/'),
  sicurauto_bombole_dm: s(
    'Sicurauto: revisione bombole metano, DM 13-5-2022',
    'https://www.sicurauto.it/news/codice-della-strada/revisione-bombole-metano-cosa-prevede-il-nuovo-decreto-13-5-2022/',
  ),
  sicurauto_gpl: s(
    'Sicurauto: bombola GPL e metano scaduta',
    'https://www.sicurauto.it/news/codice-della-strada/auto-a-metano-con-bombola-scaduta-sanzioni-e-rischi/',
  ),
  aci_art126: s('ACI: art. 126 CdS (durata della patente)', 'https://aci.gov.it/codice-della-strada/art-126/'),
  portale_patente_compleanno: s(
    "Portale dell'Automobilista: la patente scade al compleanno",
    'https://www.ilportaledellautomobilista.it/web/portale-automobilista/-/mit-la-patente-scade-al-compleanno',
  ),
  mit_rinnovo_patente: s('MIT: rinnovo patente', 'https://www.mit.gov.it/rinnovo-patente'),
  aci_legge_177: s(
    'ACI Salerno: L. 177/2024, modifiche al Codice della Strada',
    'https://salerno.aci.it/IMG/pdf/slide_legge_n._177_2024_-_modifiche_al_codice_della_strada_1_.pdf',
  ),
  aci_neopatentati: s(
    'ACI Rivista Giuridica: limitazioni per i neopatentati',
    'https://rivistagiuridica.aci.it/fileadmin/Documenti/2026/Dottrina_e_Approfondimenti/Limitazioni_per_i_neopatentati_versione_aggiornata.pdf',
  ),
  aci_pra: s(
    'ACI: passaggio di proprieta, mancata trascrizione al PRA',
    'https://aci.gov.it/pratica-auto/passaggio-di-proprieta-mancata-trascrizione-al-pra/',
  ),
  aci_art94: s('ACI: art. 94 CdS', 'https://aci.gov.it/codice-della-strada/art-94/'),
} as const satisfies Record<string, RuleSource>;
