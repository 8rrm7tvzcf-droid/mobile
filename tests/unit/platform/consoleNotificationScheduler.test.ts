import { describe, expect, it } from 'vitest';
import { diffScheduled } from '@/domain/notifications';
import type { PlannedNotification } from '@/domain/ports';
import { createConsoleNotificationScheduler } from '@/platform/notifications/consoleNotificationScheduler';

const planned = (key: string, hash = 'h1'): PlannedNotification => ({
  key,
  hash,
  date: '2026-11-30',
  time: '09:00',
  channel: 'deadlines',
  title: 'Revisione',
  body: 'Panda: scade il 30/11/2026',
});

function make(permission?: 'granted' | 'denied' | 'blocked' | 'undetermined') {
  const lines: string[] = [];
  const s = createConsoleNotificationScheduler({ log: (l) => lines.push(l), ...(permission ? { permission } : {}) });
  return { s, lines };
}

describe('createConsoleNotificationScheduler', () => {
  it('stampa il piano: una riga per notifica con chiave, data, ora, fuso, canale e testo', async () => {
    const { s, lines } = make('granted');
    await s.schedule([planned('mg1:r1:-7')], 'Europe/Rome');
    expect(lines[0]).toContain('mg1:r1:-7');
    expect(lines[0]).toContain('2026-11-30 09:00');
    expect(lines[0]).toContain('Europe/Rome');
    expect(lines[0]).toContain('[deadlines]');
    expect(lines[0]).toContain('Revisione');
  });

  it('ricorda le notifiche cosi\' la differenza idempotente funziona: seconda sincronizzazione = zero operazioni', async () => {
    const { s } = make('granted');
    const desired = [planned('mg1:r1:-7'), planned('mg1:r1:0', 'h2')];
    let diff = diffScheduled(desired, await s.listScheduled());
    expect(diff.schedule).toHaveLength(2);
    await s.schedule(diff.schedule, 'Europe/Rome');
    diff = diffScheduled(desired, await s.listScheduled());
    expect(diff).toEqual({ cancel: [], schedule: [] });
  });

  it("un cambio di contenuto (hash) riprogramma solo quella chiave", async () => {
    const { s } = make('granted');
    await s.schedule([planned('mg1:r1:-7'), planned('mg1:r2:-7')], 'Europe/Rome');
    const diff = diffScheduled([planned('mg1:r1:-7', 'nuovo'), planned('mg1:r2:-7')], await s.listScheduled());
    expect(diff.cancel).toEqual(['mg1:r1:-7']);
    expect(diff.schedule.map((d) => d.key)).toEqual(['mg1:r1:-7']);
  });

  it('cancel rimuove solo le chiavi `mg1:` presenti', async () => {
    const { s, lines } = make('granted');
    await s.schedule([planned('mg1:r1:-7'), planned('mg1:r2:-7')], 'Europe/Rome');
    await s.cancel(['mg1:r1:-7', 'mg1:non-esiste', 'altra-app:1']);
    expect([...s.scheduled.keys()]).toEqual(['mg1:r2:-7']);
    expect(lines.some((l) => l.includes('- mg1:r1:-7'))).toBe(true);
  });

  it('il permesso parte indeciso e la richiesta lo concede; denied e blocked restano tali', async () => {
    const a = make();
    expect(await a.s.getPermission()).toBe('undetermined');
    expect(await a.s.requestPermission()).toBe('granted');
    expect(await a.s.getPermission()).toBe('granted');

    for (const state of ['denied', 'blocked'] as const) {
      const b = make(state);
      expect(await b.s.requestPermission()).toBe(state);
    }
  });

  it('setPermission permette di provare i casi di rifiuto dall\'anteprima', async () => {
    const { s } = make('granted');
    s.setPermission('blocked');
    expect(await s.getPermission()).toBe('blocked');
  });
});
