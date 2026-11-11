import { afterEach, describe, expect, it } from 'vitest';
import { clearUndo, peekUndo, pushUndo } from '@/ui/hooks/undo';
import { it as italian } from '@/ui/i18n/it';
import {
  DEFAULT_KIND_BY_PARENT,
  DOCUMENT_KIND_ORDER,
  documentA11y,
  documentSubtitle,
  documentTitle,
  expiryFieldText,
  expiryView,
  formatBytes,
  groupDocuments,
  isImageMime,
  isPdf,
  kindOptions,
  mimeLabel,
  parseExpiryField,
  trashDaysText,
} from '@/ui/logic/documentsView';
import { ATTACHMENT_KINDS, type Attachment, type AttachmentKind } from '@/usecases/attachments';

let seq = 0;
const doc = (over: Partial<Attachment> = {}): Attachment => {
  seq += 1;
  return {
    id: `A${seq}`,
    vehicleId: 'V1',
    parent: { type: 'vehicle', id: 'V1' },
    kind: 'other',
    title: null,
    fileName: `file${seq}.pdf`,
    storedPath: `attachments/A${seq}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 340 * 1024,
    sha256: 'x'.repeat(64),
    isCover: false,
    createdAt: new Date(2026, 2, 12, 10, 0).toISOString(),
    updatedAt: new Date(2026, 2, 12, 10, 0).toISOString(),
    deletedAt: null,
    expiresOn: null,
    deadlineId: null,
    ...over,
  };
};

describe('raggruppamento per categoria (S-26)', () => {
  it('copre tutte le categorie del caso d\'uso, una volta sola', () => {
    expect([...DOCUMENT_KIND_ORDER].sort()).toEqual([...ATTACHMENT_KINDS].sort());
    expect(kindOptions.map((o) => o.value)).toEqual([...DOCUMENT_KIND_ORDER]);
  });

  it('ordina i gruppi (libretto per primo, altro per ultimo) e salta quelli vuoti', () => {
    const list = [doc({ kind: 'other' }), doc({ kind: 'receipt' }), doc({ kind: 'registration_doc' }), doc({ kind: 'receipt' }), doc({ kind: 'photo' })];
    const groups = groupDocuments(list);
    expect(groups.map((g) => g.kind)).toEqual(['registration_doc', 'receipt', 'photo', 'other']);
    expect(groups.map((g) => g.title)).toEqual(['Libretto / Documento Unico', 'Ricevute', 'Foto', 'Altro']);
    expect(groups[1]?.items).toHaveLength(2);
    expect(groupDocuments([])).toEqual([]);
  });

  it('dentro un gruppo tiene l\'ordine ricevuto (piu\' recente prima)', () => {
    const a = doc({ kind: 'invoice' });
    const b = doc({ kind: 'invoice' });
    expect(groupDocuments([b, a])[0]?.items.map((x) => x.id)).toEqual([b.id, a.id]);
  });

  it('propone una categoria sensata per ogni genitore', () => {
    expect(DEFAULT_KIND_BY_PARENT.service_record).toBe('invoice');
    expect(DEFAULT_KIND_BY_PARENT.policy).toBe('policy');
    expect(DEFAULT_KIND_BY_PARENT.fuel_log).toBe('receipt');
    expect(DEFAULT_KIND_BY_PARENT.expense).toBe('receipt');
    for (const kind of Object.values(DEFAULT_KIND_BY_PARENT) as AttachmentKind[]) expect(ATTACHMENT_KINDS).toContain(kind);
  });
});

describe('testi di riga', () => {
  it('dimensioni leggibili', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(340 * 1024)).toBe('340 KB');
    expect(formatBytes(1.2 * 1024 * 1024)).toBe('1,2 MB');
    expect(formatBytes(250 * 1024 * 1024)).toBe('250 MB');
    expect(formatBytes(-1)).toBe('');
    expect(formatBytes(Number.NaN)).toBe('');
  });

  it('titolo scelto o nome del file; tipo PDF o foto', () => {
    expect(documentTitle({ title: '  Libretto  ', fileName: 'x.pdf' })).toBe('Libretto');
    expect(documentTitle({ title: null, fileName: 'scan.pdf' })).toBe('scan.pdf');
    expect(documentTitle({ title: '   ', fileName: 'scan.pdf' })).toBe('scan.pdf');
    expect(isPdf('application/pdf')).toBe(true);
    expect(isImageMime('image/jpeg')).toBe(true);
    expect(mimeLabel('application/pdf')).toBe('PDF');
    expect(mimeLabel('image/webp')).toBe('Foto');
  });

  it('sottotitolo con categoria, tipo, dimensione e data di aggiunta', () => {
    expect(documentSubtitle(doc({ kind: 'receipt' }))).toBe('Ricevuta · PDF · 340 KB · aggiunto il 12/03/2026');
  });
});

describe('scadenza del documento', () => {
  const today = '2026-10-13';

  it('nessuna scadenza = nessun semaforo', () => {
    expect(expiryView({ expiresOn: null }, today)).toBeNull();
    expect(expiryFieldText(null)).toBe('');
    expect(expiryFieldText('2027-01-05')).toBe('05/01/2027');
  });

  it('scaduto e in scadenza sono sempre testo + icona, mai solo colore', () => {
    expect(expiryView({ expiresOn: '2026-10-10' }, today)).toEqual({ tone: 'danger', icon: 'alert', label: 'Scaduto da 3 giorni (10/10/2026)' });
    expect(expiryView({ expiresOn: '2026-10-12' }, today)?.label).toBe('Scaduto da 1 giorno (12/10/2026)');
    expect(expiryView({ expiresOn: today }, today)).toEqual({ tone: 'danger', icon: 'alert', label: 'Scade oggi' });
    expect(expiryView({ expiresOn: '2026-10-14' }, today)).toEqual({ tone: 'warning', icon: 'clock', label: 'Scade tra 1 giorno (14/10/2026)' });
    expect(expiryView({ expiresOn: '2026-11-12' }, today)?.tone).toBe('warning');
    expect(expiryView({ expiresOn: '2026-11-13' }, today)).toEqual({ tone: 'ok', icon: 'check', label: 'Scade il 13/11/2026' });
  });

  it('la frase per il lettore di schermo comprende titolo, dettagli e scadenza', () => {
    const text = documentA11y(doc({ title: 'Polizza', kind: 'policy', expiresOn: '2026-10-10' }), today);
    expect(text).toContain('Polizza');
    expect(text).toContain('Assicurazione');
    expect(text).toContain('Scaduto da 3 giorni');
  });

  it('il campo data: vuoto toglie la scadenza, gg/mm/aaaa la imposta, il resto da\' un errore in italiano', () => {
    expect(parseExpiryField('')).toEqual({ ok: true, value: null });
    expect(parseExpiryField('  ')).toEqual({ ok: true, value: null });
    expect(parseExpiryField('15/03/2027')).toEqual({ ok: true, value: '2027-03-15' });
    expect(parseExpiryField('2027-03-15')).toEqual({ ok: true, value: '2027-03-15' });
    expect(parseExpiryField('31/02/2027')).toEqual({ ok: false, error: italian.common.dateExample });
    expect(parseExpiryField('domani')).toEqual({ ok: false, error: italian.common.dateExample });
  });
});

describe('cestino', () => {
  it('giorni rimasti in italiano', () => {
    expect(trashDaysText(30)).toBe('Restano ancora 30 giorni');
    expect(trashDaysText(1)).toBe('Resta ancora 1 giorno');
    expect(trashDaysText(0)).toBe('Verrà eliminato definitivamente oggi');
  });
});

describe('annulla della rimozione di un allegato', () => {
  afterEach(() => clearUndo());

  it('l\'allegato eliminato si ripristina con «Annulla»', () => {
    pushUndo({ mode: 'deleted', kind: 'attachment', itemId: 'A1', vehicleId: 'V1', message: italian.attachments.removedMessage });
    expect(peekUndo()).toMatchObject({ mode: 'deleted', kind: 'attachment', itemId: 'A1', vehicleId: 'V1', message: 'Allegato rimosso.' });
  });
});
