import { describe, expect, it } from 'vitest';
import {
  APP_DIRS,
  baseName,
  guessMimeType,
  isAlreadyCompressed,
  mimeToUti,
  normalizeVirtualPath,
} from '@/platform/files/paths';

describe('APP_DIRS', () => {
  it("sono percorsi relativi: `${attachments}/<id>.<ext>` e' gia' un stored_path valido (GLOB 'attachments/*')", () => {
    expect(APP_DIRS).toEqual({ attachments: 'attachments', backups: 'backups', temp: 'temp' });
    expect(`${APP_DIRS.attachments}/01ABC.pdf`).toMatch(/^attachments\//);
  });
});

describe('baseName', () => {
  it('prende l\'ultimo segmento di percorsi e URI', () => {
    expect(baseName('attachments/01ABC.pdf')).toBe('01ABC.pdf');
    expect(baseName('file:///data/user/0/app/cache/DocumentPicker/abc-123.pdf')).toBe('abc-123.pdf');
    expect(baseName('file:///x/y/')).toBe('y');
  });
  it('ignora query e frammento e decodifica i %XX', () => {
    expect(baseName('file:///cache/Ricevuta%20officina.jpg?x=1#frag')).toBe('Ricevuta officina.jpg');
  });
  it('una sequenza %XX invalida resta com\'e\' e un percorso vuoto da stringa vuota', () => {
    expect(baseName('file:///cache/100%.jpg')).toBe('100%.jpg');
    expect(baseName('')).toBe('');
    expect(baseName('///')).toBe('');
  });
});

describe('normalizeVirtualPath', () => {
  it('toglie segmenti vuoti e punti', () => {
    expect(normalizeVirtualPath('/attachments//a/./b.pdf')).toBe('attachments/a/b.pdf');
    expect(normalizeVirtualPath('')).toBe('');
    expect(normalizeVirtualPath('./')).toBe('');
  });
  it("rifiuta '..' in qualunque posizione (path traversal)", () => {
    expect(() => normalizeVirtualPath('../x')).toThrow(/non valido/);
    expect(() => normalizeVirtualPath('attachments/../../x')).toThrow(/non valido/);
  });
});

describe('tipi di file', () => {
  it("guessMimeType dedotto dall'estensione, senza distinguere maiuscole", () => {
    expect(guessMimeType('foto.JPG')).toBe('image/jpeg');
    expect(guessMimeType('a.b.pdf')).toBe('application/pdf');
    expect(guessMimeType('backup.zip')).toBe('application/zip');
    expect(guessMimeType('senzaestensione')).toBeNull();
    expect(guessMimeType('punto.')).toBeNull();
    expect(guessMimeType('x.sconosciuta')).toBeNull();
  });
  it('mimeToUti conosce lo ZIP e ignora i tipi ignoti', () => {
    expect(mimeToUti('application/zip')).toBe('public.zip-archive');
    expect(mimeToUti('APPLICATION/JSON')).toBe('public.json');
    expect(mimeToUti('application/x-boh')).toBeUndefined();
  });
  it('isAlreadyCompressed riconosce immagini e archivi', () => {
    expect(isAlreadyCompressed('attachments/A.jpg')).toBe(true);
    expect(isAlreadyCompressed('attachments/A.HEIC')).toBe(true);
    expect(isAlreadyCompressed('data.json')).toBe(false);
    expect(isAlreadyCompressed('noext')).toBe(false);
  });
});
