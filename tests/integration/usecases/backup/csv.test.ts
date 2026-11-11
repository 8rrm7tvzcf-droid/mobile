// Esportazione CSV (F-08, AC-11 punto 5): due varianti, protezione dalla formula injection, importi con aritmetica intera.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CSV_ENTITY_NAMES, exportCsv, formatScaled, neutralizeFormula, toCsv } from '@/usecases/backup';
import type { CsvColumn } from '@/usecases/backup';
import { fuelLogRow, insertRow, vehicleRow } from '../../../support/db';
import { ulidOf } from '../../../support/fakes';
import { SAMPLE_IDS } from '../../../support/sampleData';
import { errorCode, makeBackupEnv, seedGarage, unwrap, type BackupEnv, type Garage } from './harness';

const COLS: CsvColumn[] = [
  { key: 't', label: 'Testo', type: 'text' },
  { key: 'n', label: 'Numero', type: 'int' },
  { key: 'c', label: 'Importo (EUR)', type: 'cents' },
  { key: 'm', label: 'Quantità', type: 'milli' },
  { key: 'd', label: 'Data', type: 'date' },
  { key: 'b', label: 'Sì/no', type: 'bool' },
  { key: 'k', label: 'Tipo', type: 'text', map: { petrol: 'Benzina' } },
];

describe('toCsv', () => {
  const row = { t: 'ciao', n: -3, c: 123456, m: 1833, d: '2026-03-01', b: 1, k: 'petrol' };

  it('variante Excel italiana: ; BOM gg/mm/aaaa virgola decimale si/no etichette italiane, CRLF', () => {
    const csv = toCsv([row], COLS, 'excel-it');
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toBe('﻿Testo;Numero;"Importo (EUR)";Quantità;Data;Sì/no;Tipo\r\nciao;-3;1234,56;1,833;01/03/2026;si;Benzina\r\n'.replace('"Importo (EUR)"', 'Importo (EUR)'));
  });

  it('variante dati: , ISO punto decimale 0/1 codici grezzi senza BOM', () => {
    const csv = toCsv([row, { ...row, b: 0, c: 5, d: null }], COLS, 'data');
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(csv).toBe('Testo,Numero,Importo (EUR),Quantità,Data,Sì/no,Tipo\r\nciao,-3,1234.56,1.833,2026-03-01,1,petrol\r\nciao,-3,0.05,1.833,,0,petrol\r\n');
  });

  it('importi con aritmetica intera: nessun errore di virgola mobile, nemmeno sui valori grandi o negativi', () => {
    expect(formatScaled(5, 2, ',')).toBe('0,05');
    expect(formatScaled(100, 2, ',')).toBe('1,00');
    expect(formatScaled(1, 2, '.')).toBe('0.01');
    expect(formatScaled(100_000_000_000, 2, ',')).toBe('1000000000,00');
    expect(formatScaled(-12345, 2, ',')).toBe('-123,45');
    expect(formatScaled(1833, 3, ',')).toBe('1,833');
    // 0,1 + 0,2 in virgola mobile sbaglia: qui sono interi (10 + 20 centesimi = 0,30)
    expect(formatScaled(10 + 20, 2, ',')).toBe('0,30');
    expect(formatScaled(2200, 3, '.')).toBe('2.200');
  });

  it('protezione dalla formula injection: = + - @ tab e a capo ricevono un apice (solo celle di testo)', () => {
    const inj = (t: string, variant: 'excel-it' | 'data' = 'excel-it'): string => toCsv([{ t }], [{ key: 't', label: 'T', type: 'text' }], variant).split('\r\n')[1] as string;
    expect(inj(`=cmd|' /C calc'!A0`)).toBe(`'=cmd|' /C calc'!A0`);
    expect(inj('+39 333 1234567')).toBe("'+39 333 1234567");
    expect(inj('-2+3')).toBe("'-2+3");
    expect(inj('@SUM(A1:A9)')).toBe("'@SUM(A1:A9)");
    expect(inj('\tTab')).toBe("'\tTab");
    expect(inj('\rCR')).toBe(`"'\rCR"`);
    expect(inj('\nA capo')).toBe(`"'\nA capo"`);
    expect(inj('=1+1', 'data')).toBe("'=1+1");
    // il testo normale non cambia, nemmeno se contiene = + - @ in mezzo
    expect(inj('a=b+c-d@e')).toBe('a=b+c-d@e');
    expect(neutralizeFormula('=A1')).toBe("'=A1");
    // i numeri negativi (colonne numeriche) non si toccano
    expect(toCsv([{ n: -7, c: -250 }], [{ key: 'n', label: 'N', type: 'int' }, { key: 'c', label: 'C', type: 'cents' }], 'data').split('\r\n')[1]).toBe('-7,-2.50');
  });

  it('campi con separatore, virgolette o a capo si racchiudono tra virgolette con raddoppio', () => {
    const one = (t: string, v: 'excel-it' | 'data'): string => toCsv([{ t }], [{ key: 't', label: 'T', type: 'text' }], v).split('\r\n').slice(1, -1).join('\r\n');
    expect(one('a;b', 'excel-it')).toBe('"a;b"');
    expect(one('a,b', 'data')).toBe('"a,b"');
    expect(one('dice "ciao"', 'excel-it')).toBe('"dice ""ciao"""');
    expect(one('riga1\nriga2', 'data')).toBe('"riga1\nriga2"');
    expect(one('a,b', 'excel-it')).toBe('"a,b"'); // la virgola e' il decimale: meglio quotare comunque
  });
});

describe('exportCsv', () => {
  let env: BackupEnv;
  let g: Garage;
  beforeEach(async () => {
    env = await makeBackupEnv();
    g = await seedGarage(env);
  });
  afterEach(() => env.cleanup());

  const readZip = async (path: string): Promise<Record<string, string>> => {
    const dec = new TextDecoder('utf-8', { ignoreBOM: true });
    return Object.fromEntries(env.deps.fs.zip.unzip(new Uint8Array(await env.files.read(path))).map((e) => [e.name, dec.decode(e.bytes)] as const));
  };
  const lines = (csv: string): string[] => csv.split('\r\n').filter((l) => l !== '');

  it('tutte le entita in uno ZIP nella cartella temporanea, variante Excel italiana', async () => {
    const r = unwrap(await exportCsv(env.deps, { variant: 'excel-it' }));
    expect(r.mimeType).toBe('application/zip');
    expect(r.fileName).toBe('MyGarage-CSV-2026-10-08.zip');
    expect(r.path).toBe(`${env.dirs.temp}/MyGarage-CSV-2026-10-08.zip`);
    expect(r.files.map((f) => f.name)).toEqual(CSV_ENTITY_NAMES);
    const zip = await readZip(r.path);
    expect(Object.keys(zip).sort()).toEqual([
      'assicurazioni.csv', 'codici_errore.csv', 'controlli_livelli.csv', 'gomme.csv', 'interventi.csv', 'letture_km.csv',
      'rate_assicurazione.csv', 'rifornimenti.csv', 'scadenze.csv', 'spese.csv', 'veicoli.csv', 'voci_intervento.csv',
    ]);
    for (const csv of Object.values(zip)) expect(csv.startsWith('﻿')).toBe(true);

    const veicoli = lines(zip['veicoli.csv'] as string);
    expect(veicoli).toHaveLength(2); // intestazione + l'unica auto reale (niente demo, niente cestino)
    expect(veicoli[0]).toBe('﻿ID;Soprannome;Targa;Telaio (VIN);Marca;Modello;Versione;Anno modello;Prima immatricolazione;Motorizzazione;Alimentazione;Alimentazione secondaria;Cilindrata (cc);Potenza (kW);Classe Euro;Stato;Data acquisto;Km acquisto;Prezzo acquisto (EUR);Data vendita;Km vendita;Prezzo vendita (EUR);Note');
    expect(veicoli[1]).toContain(`${SAMPLE_IDS.vehicle1};Auto di prova;TEST001;;Marca;Modello;;2020;15/03/2020;Termico;Benzina;;;;;Attiva`);

    const interventi = lines(zip['interventi.csv'] as string);
    expect(interventi[1]).toContain(`${SAMPLE_IDS.service1};${SAMPLE_IDS.vehicle1};01/03/2026;Programmato;Tagliando;Officina di prova;210,00;`);
    const rifornimenti = lines(zip['rifornimenti.csv'] as string);
    expect(rifornimenti).toHaveLength(3); // niente rifornimento nel cestino
    expect(rifornimenti.join('\n')).toContain(`${ulidOf(50)};${SAMPLE_IDS.vehicle1};10/05/2026;Benzina;;30,000;L;1,833;55,00;si;no`);
    const spese = lines(zip['spese.csv'] as string);
    expect(spese.join('\n')).toContain('Autolavaggio;15,50');
    expect(spese.join('\n')).toContain('Parcheggio e sosta;12,00'); // categoria di sistema
    const rate = lines(zip['rate_assicurazione.csv'] as string);
    expect(rate[1]).toContain(`;1;01/01/2026;200,00;02/01/2026`);
    expect(rate[2]).toContain(`;2;01/07/2026;200,00;`);
    const voci = lines(zip['voci_intervento.csv'] as string);
    expect(voci[1]).toContain('Fluido;Olio motore;1,000;;90,00;');
    const km = lines(zip['letture_km.csv'] as string);
    expect(km.some((l) => l.includes(';99999;') && l.includes('Ignorata'))).toBe(true);
    const livelli = lines(zip['controlli_livelli.csv'] as string);
    expect(livelli[1]).toContain('Pressione gomme;OK;;2,200');
    const gomme = lines(zip['gomme.csv'] as string);
    expect(gomme[1]).toContain('Estive');
    const dtc = lines(zip['codici_errore.csv'] as string);
    expect(dtc[1]).toContain('P0420;Memorizzato;Attivo');
    const ass = lines(zip['assicurazioni.csv'] as string);
    expect(ass[1]).toContain('RC auto;Compagnia di prova;');
    expect(ass[1]).toContain('01/01/2026;01/01/2027;400,00;Semestrale');
    // scadenze: regole con ultima esecuzione e prossima scadenza, piu' le scadenze personalizzate
    const scadenze = lines(zip['scadenze.csv'] as string);
    const olio = scadenze.find((l) => l.includes('Cambio olio')) as string;
    expect(olio).toContain('Regola;Cambio olio;Manutenzione');
    expect(olio).toContain('01/03/2026;12000;01/03/2027;27000;Aperta;si');
    expect(scadenze.some((l) => l.includes('Personalizzata;Controllare le gomme'))).toBe(true);
    expect(scadenze.some((l) => l.includes('Personalizzata;Scadenza: Libretto') && l.includes('15/03/2027'))).toBe(true);
  });

  it('variante dati: virgola, date ISO, punto decimale, 0/1, codici grezzi, senza BOM', async () => {
    const r = unwrap(await exportCsv(env.deps, { variant: 'data' }));
    const zip = await readZip(r.path);
    for (const csv of Object.values(zip)) expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(lines(zip['interventi.csv'] as string)[1]).toContain(`${SAMPLE_IDS.service1},${SAMPLE_IDS.vehicle1},2026-03-01,scheduled,Tagliando,Officina di prova,210.00,`);
    expect(lines(zip['rifornimenti.csv'] as string).join('\n')).toContain(`${ulidOf(50)},${SAMPLE_IDS.vehicle1},2026-05-10,petrol,,30.000,L,1.833,55.00,1,0`);
    expect(lines(zip['veicoli.csv'] as string)[0]).toContain('ID,Soprannome,Targa');
  });

  it('un solo elenco: un file .csv', async () => {
    const r = unwrap(await exportCsv(env.deps, { variant: 'excel-it', entities: ['spese'] }));
    expect(r).toMatchObject({ mimeType: 'text/csv', fileName: 'MyGarage-spese-2026-10-08.csv', files: [{ name: 'spese', rows: 2 }] });
    const raw = new Uint8Array(await env.files.read(r.path));
    expect([...raw.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(env.dirs.temp).toBe(r.path.slice(0, r.path.lastIndexOf('/')));
  });

  it('per una sola auto', async () => {
    const other = await insertRow(env.db, 'vehicles', vehicleRow({ nickname: 'Altra auto' }));
    await insertRow(env.db, 'fuel_logs', fuelLogRow(other, { total_cents: 7777 }));
    const mine = unwrap(await exportCsv(env.deps, { variant: 'data', entities: ['rifornimenti', 'veicoli'], scope: { vehicleId: other } }));
    const zip = await readZip(mine.path);
    expect(lines(zip['rifornimenti.csv'] as string)).toHaveLength(2);
    expect(zip['rifornimenti.csv']).toContain('77.77');
    expect(lines(zip['veicoli.csv'] as string)).toHaveLength(2);
    expect(zip['veicoli.csv']).toContain('Altra auto');
    // senza scope: due auto reali, ancora niente demo
    const all = unwrap(await exportCsv(env.deps, { variant: 'data', entities: ['veicoli'] }));
    expect(all.files).toEqual([{ name: 'veicoli', rows: 2 }]);
    expect(errorCode(await exportCsv(env.deps, { variant: 'data', scope: { vehicleId: ulidOf(999) } }))).toBe('ITEM_NOT_FOUND');
    expect(errorCode(await exportCsv(env.deps, { variant: 'data', entities: [] }))).toBe('BAD_DATA');
    expect(errorCode(await exportCsv(env.deps, { variant: 'data', entities: ['segreti' as never] }))).toBe('BAD_DATA');
  });

  it('i dati dell utente con formule sono neutralizzati nei file veri', async () => {
    await env.db.run(`UPDATE vehicles SET nickname = '=HYPERLINK("http://evil.example","clic")', notes = '@cmd', updated_at = '2026-06-02T00:00:00.000Z' WHERE id = ?`, [g.vehicleId]);
    await env.db.run(`UPDATE workshops SET name = '+39 06 1234', updated_at = '2026-06-02T00:00:00.000Z'`);
    const r = unwrap(await exportCsv(env.deps, { variant: 'excel-it', entities: ['veicoli', 'interventi'] }));
    const zip = await readZip(r.path);
    expect(zip['veicoli.csv']).toContain(`"'=HYPERLINK(""http://evil.example"",""clic"")"`);
    expect(zip['veicoli.csv']).toContain(";'@cmd");
    expect(zip['interventi.csv']).toContain(";'+39 06 1234;");
    expect(zip['veicoli.csv']).not.toMatch(/;=HYPERLINK/);
  });
});
