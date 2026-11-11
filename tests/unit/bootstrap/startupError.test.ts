import { describe, expect, it } from 'vitest';
import { describeStartupError } from '@/bootstrap/startupError';
import { DatabaseBootError, SchemaTooNewError, type BootFailureKind } from '@/data';

const boot = (kind: BootFailureKind, message = 'dettaglio tecnico'): DatabaseBootError =>
  new DatabaseBootError(kind === 'seed-failed' ? 'seed' : kind === 'pragma-failed' || kind === 'sqlite-too-old' ? 'pragmas' : 'migrate', kind, new Error(message));

describe('describeStartupError', () => {
  it("database piu' nuovo dell'app: schermata \"Aggiorna MyGarage\"", () => {
    const info = describeStartupError(boot('schema-too-new', 'versione 9 > 1'));
    expect(info.kind).toBe('update-required');
    expect(info.title).toBe('Aggiorna MyGarage');
    expect(info.message).toContain('Aggiorna');
    expect(info.detail).toContain('schema-too-new');
    expect(info.detail).toContain('versione 9 > 1');
  });

  it('SchemaTooNewError lanciato direttamente vale lo stesso', () => {
    expect(describeStartupError(new SchemaTooNewError(9, 1)).kind).toBe('update-required');
  });

  it('migrazione fallita: dice che i dati sono al sicuro e ricorda la copia di sicurezza', () => {
    const info = describeStartupError(boot('migration-failed'));
    expect(info.kind).toBe('data-problem');
    expect(info.message).toContain('non sono stati cancellati');
    expect(info.message).toContain('copia di sicurezza');
  });

  it('ogni tipo di errore di avvio ha titolo e messaggio in italiano, senza testi SQLite nel messaggio', () => {
    const kinds: BootFailureKind[] = [
      'schema-too-new',
      'unknown-database',
      'checksum-mismatch',
      'migration-failed',
      'seed-failed',
      'pragma-failed',
      'sqlite-too-old',
    ];
    for (const k of kinds) {
      const info = describeStartupError(boot(k, 'SQLITE_ERROR: no such table x'));
      expect(info.title.length).toBeGreaterThan(5);
      expect(info.message.length).toBeGreaterThan(30);
      expect(info.message).not.toMatch(/SQLITE|sqlite_|no such table/);
      expect(info.detail).toContain(k);
    }
  });

  it('SQLite troppo vecchio: telefono non supportato', () => {
    expect(describeStartupError(boot('sqlite-too-old')).kind).toBe('unsupported-device');
  });

  it('un errore qualunque diventa un messaggio generico con il testo come codice', () => {
    const info = describeStartupError(new Error('boom'));
    expect(info.kind).toBe('unexpected');
    expect(info.detail).toBe('boom');
    expect(describeStartupError('stringa').detail).toBe('stringa');
  });
});
