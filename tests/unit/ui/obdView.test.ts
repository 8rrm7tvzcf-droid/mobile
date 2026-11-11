// Presentazione OBD (src/ui/logic/obdView.ts) su dati veri del simulatore, piu' i controlli di onesta' sui testi.
import { describe, expect, it } from 'vitest';
import { createObdService, type CapabilityReport, type DemoScenario, type LiveSample, type ObdFailureCode, type Snapshot } from '@/bootstrap/obdService';
import { SimulatedTransport } from '@/obd/transport/SimulatedTransport';
import { it as strings } from '@/ui/i18n/it';
import {
  availabilityStyle,
  checklistRows,
  compatSummary,
  dtcSectionKind,
  dtcView,
  EMPTY_LIVE,
  failureText,
  formatDecimal,
  formatReadAt,
  mergeLive,
  milKind,
  pidValueText,
  provenanceLabel,
  snapshotHasData,
  valueRows,
  vinView,
} from '@/ui/logic/obdView';

async function read(scenario: DemoScenario): Promise<{ snapshot: Snapshot; report: CapabilityReport }> {
  const service = createObdService({
    clock: { nowIso: () => '2026-10-08T10:00:00.000Z' },
    session: { recoveryMs: 30, timeoutScale: 0.05 },
    init: { postResetDelayMs: 0, unableRetryDelayMs: 1, noDataRetryDelayMs: 1, searchTimeoutMs: 300 },
    createDemoTransport: (s) => new SimulatedTransport({ scenario: s, latencyMs: 0, searchDelayMs: 0, chunkDelayMs: 0 }),
  });
  const opened = await service.openDemo(scenario);
  if (!opened.ok) throw new Error('demo non aperta');
  const snap = await service.snapshot();
  const caps = await service.capabilities();
  if (!snap.ok || !caps.ok) throw new Error('lettura fallita');
  await service.close();
  return { snapshot: snap.value, report: caps.value };
}

describe('formati', () => {
  it('numeri all\'italiana e data della lettura', () => {
    expect(formatDecimal(1234.5, 1)).toBe('1.234,5');
    expect(formatDecimal(14.123, 1)).toBe('14,1');
    expect(formatDecimal(780, 0)).toBe('780');
    expect(formatDecimal(Number.NaN, 1)).toBe('–');
    expect(formatReadAt('2026-10-08T10:00:00.000Z')).toMatch(/^\d{2}\/\d{2}\/2026 alle \d{2}:\d{2}$/);
    expect(formatReadAt('non una data')).toBe('');
  });

  it('le tre provenienze hanno un\'etichetta italiana', () => {
    expect(provenanceLabel('read')).toBe('Letto dall’auto');
    expect(provenanceLabel('estimated')).toBe('Stimato');
    expect(provenanceLabel('entered')).toBe('Inserito da te');
  });
});

describe('codici guasto', () => {
  it('sistema, standard/costruttore e descrizione in italiano', () => {
    const v = dtcView('P0420');
    expect(v.system).toBe('Motore e cambio');
    expect(v.generic).toBe(true);
    expect(v.description).toMatch(/catalizzatore/i);
    expect(v.a11y).toContain('P0420');
    expect(dtcView('P1234').generic).toBe(false);
    expect(dtcView('U0100').system).toBe('Rete di comunicazione');
    expect(dtcView('C0035').system).toBe('Telaio');
    expect(dtcView('B0001').system).toBe('Carrozzeria');
  });

  it('mancate accensioni per cilindro e codice sconosciuto senza inventare descrizioni', () => {
    expect(dtcView('P0304').description).toBe('Mancate accensioni nel cilindro 4.');
    const unknown = dtcView('P0999');
    expect(unknown.description).toBeNull();
    expect(unknown.text).toBe(strings.obd.snapshot.dtcNoDescription);
  });
});

describe('snapshot: benzina normale', () => {
  it('spia spenta, VIN, valori con provenienza e righe nell\'ordine giusto', async () => {
    const { snapshot } = await read('petrol');
    expect(milKind(snapshot)).toBe('off');
    expect(snapshotHasData(snapshot)).toBe(true);
    for (const s of [snapshot.dtc.stored, snapshot.dtc.pending, snapshot.dtc.permanent]) expect(dtcSectionKind(s)).toBe('empty');

    const rows = valueRows(snapshot);
    expect(rows[0].id).toBe('engine_rpm');
    expect(rows[0].label).toBe('Giri motore');
    expect(rows[0].value).toMatch(/giri\/min$/);
    expect(rows[0].source).toBe('read');
    expect(rows[0].a11y).toContain('Letto dall’auto');
    expect(rows[rows.length - 1].id).toBe('adapter_voltage');
    expect(rows.every((r) => r.source === 'read')).toBe(true);
    expect(rows.map((r) => r.id)).not.toContain('obd_standard');
    // il simulatore a benzina non espone chilometri: non compaiono tra i valori letti
    expect(rows.map((r) => r.id)).not.toContain('odometer');

    const rpm = snapshot.pids.engine_rpm.value;
    expect(pidValueText(rpm)).toBe(rows[0].value);
  });

  it('VIN: confronto con quello salvato nella scheda auto', async () => {
    const { snapshot } = await read('petrol');
    expect(vinView(snapshot, null)).toMatchObject({ kind: 'read', vin: 'ZFA19900001234567', compare: 'saved-none' });
    expect(vinView(snapshot, 'zfa19900001234567')).toMatchObject({ compare: 'same' });
    expect(vinView(snapshot, 'WVWZZZ1KZ6W123456')).toMatchObject({ compare: 'differs', saved: 'WVWZZZ1KZ6W123456' });
    expect(vinView({ ...snapshot, vin: null, vinStatus: 'unsupported' }, null)).toEqual({ kind: 'missing' });
    expect(vinView({ ...snapshot, vin: null, vinStatus: 'invalid' }, null)).toEqual({ kind: 'invalid' });
    expect(vinView({ ...snapshot, vin: null, vinStatus: 'error' }, null)).toEqual({ kind: 'error' });
  });

  it('senza nessuna risposta si parla di "nessun dato", non di un\'auto sana', async () => {
    const { snapshot } = await read('petrol');
    const empty: Snapshot = {
      ...snapshot,
      vin: null,
      vinStatus: 'unsupported',
      status: null,
      freezeFrame: null,
      pids: {},
      adapterVoltage: null,
      dtc: {
        stored: { status: 'error', codes: [], byEcu: [] },
        pending: { status: 'unsupported', codes: [], byEcu: [] },
        permanent: { status: 'unsupported', codes: [], byEcu: [] },
      },
    };
    expect(snapshotHasData(empty)).toBe(false);
    expect(milKind(empty)).toBe('unknown');
  });

  it('report di capacita\': checklist con testi nostri; i km non letti restano "da inserire a mano"', async () => {
    const { report } = await read('petrol');
    const rows = checklistRows(report);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.engine_rpm.available).toBe(true);
    expect(byKey.engine_rpm.detail).toBeNull();
    expect(byKey.odometer.available).toBe(false);
    expect(byKey.odometer.detail).toBe(strings.obd.compat.notDeclared);
    expect(byKey.freeze_frame.available).toBe(false);
    expect(byKey.freeze_frame.detail).toBe(strings.obd.compat.freezeUntested);
    expect(byKey.vin.label).toBe('Numero di telaio (VIN)');
    const sum = compatSummary(report);
    expect(sum.noEcu).toBe(false);
    expect(sum.noPid).toBe(false);
    expect(sum.answered).toBeGreaterThan(5);
    expect(sum.ecus).toContain('7E8');
  });
});

describe('snapshot: spia accesa', () => {
  it('spia, codici con descrizione e freeze frame', async () => {
    const { snapshot } = await read('mil-on');
    expect(milKind(snapshot)).toBe('on');
    expect(dtcSectionKind(snapshot.dtc.stored)).toBe('ok');
    const views = snapshot.dtc.stored.codes.map(dtcView);
    expect(views.map((v) => v.code)).toEqual(['P0420', 'P0301', 'P0171']);
    expect(views.every((v) => v.description !== null)).toBe(true);
    expect(snapshot.freezeFrame?.value.dtc).toBe('P0420');
    expect(strings.obd.snapshot.milOnText(3)).toContain('3 codici guasto');
    expect(strings.obd.snapshot.milOnText(1)).toContain('1 codice guasto');
  });
});

describe('dati live', () => {
  it('ogni campione porta solo i PID del ciclo: si tiene l\'ultimo valore noto', async () => {
    const { snapshot } = await read('petrol');
    const rpm = snapshot.pids.engine_rpm;
    const coolant = snapshot.pids.coolant_temp;
    const first: LiveSample = { cycle: 0, elapsedMs: 0, readAt: '2026-10-08T10:00:00.000Z', values: { engine_rpm: rpm, coolant_temp: coolant }, dropped: [] };
    const second: LiveSample = { cycle: 1, elapsedMs: 500, readAt: '2026-10-08T10:00:01.000Z', values: { engine_rpm: rpm }, dropped: [] };
    const merged = mergeLive(mergeLive(EMPTY_LIVE, first), second);
    expect(merged.samples).toBe(2);
    expect(merged.coolant).toBe(coolant);
    expect(merged.rpm).toBe(rpm);
    expect(merged.adapterVoltage).toBeNull();
    expect(merged.lastAt).toBe('2026-10-08T10:00:01.000Z');
  });
});

describe('onesta\' dei testi (SPEC 5.4)', () => {
  it('ogni esito di collegamento ha un titolo e un testo, con "Riprova" disponibile dalla UI', () => {
    const codes: ObdFailureCode[] = ['NO_RESPONSE', 'UNABLE_TO_CONNECT', 'NO_DATA', 'BUS_ERROR', 'ADAPTER_RESET', 'BAD_RESPONSE', 'DISCONNECTED', 'NOT_CONNECTED', 'READ_FAILED'];
    for (const c of codes) {
      const f = failureText(c);
      expect(f.title.length).toBeGreaterThan(5);
      expect(f.text.length).toBeGreaterThan(20);
    }
    expect(strings.common.retry).toBe('Riprova');
  });

  it('la tabella dice NO a olio, tagliando, gomme, freni e batteria; ogni voce ha icona e testo', () => {
    const rows = strings.obd.table.rows;
    for (const key of ['oil', 'service', 'tyres', 'brakes', 'battery']) expect(rows.find((r) => r.key === key)?.value).toBe('no');
    expect(rows.find((r) => r.key === 'mil')?.value).toBe('yes');
    for (const v of ['yes', 'sometimes', 'no'] as const) {
      const st = availabilityStyle(v);
      expect(st.label.length).toBeGreaterThan(1);
      expect(st.icon).toBeTruthy();
    }
    // il semaforo non e' mai solo colore e le tre voci hanno icone diverse
    expect(new Set(['yes', 'sometimes', 'no'].map((v) => availabilityStyle(v as 'yes').icon)).size).toBe(3);
  });

  it('la guida all\'adattatore: BLE per iPhone e Android, classico solo Android, Bluetooth dell\'auto inutile, niente marche ne\' prezzi', () => {
    const text = strings.obd.guide.sections.map((s) => `${s.title} ${s.text}`).join(' ');
    expect(text).toMatch(/BLE/);
    expect(text).toMatch(/iPhone/);
    expect(text).toMatch(/solo con Android/);
    expect(text).toMatch(/telefonate e musica/);
    expect(text).toMatch(/NON dà i dati/);
    expect(text).toMatch(/presa diagnostica/);
    expect(text).toMatch(/cloni/i);
    expect(text).not.toMatch(/OBDLink|Vgate|vLinker|Car Scanner|ScanX|Carly|Torque|€|euro|USD/i);
  });

  it('l\'introduzione promette solo cio\' che l\'OBD da\' e dichiara la sola lettura', () => {
    const i = strings.obd.intro;
    expect(i.cannot.join(' ')).toMatch(/olio/i);
    expect(i.cannot.join(' ')).toMatch(/gomme/i);
    expect(i.cannot.join(' ')).toMatch(/batteria/i);
    expect(i.readOnly).toMatch(/non cancella i codici/);
    expect(i.realText).toMatch(/adattatore/);
    expect(i.realText).toMatch(/versione di prova/);
    const all = JSON.stringify(strings.obd).toLowerCase();
    for (const banned of ['legge tutto', 'compila da sola', 'stato di salute della batteria', 'funziona con tutte']) expect(all).not.toContain(banned);
  });
});
