// Scheduler FINTO (porta NotificationScheduler): tiene le notifiche in memoria e registra ogni chiamata.
import type { NotificationScheduler, PermissionState, PlannedNotification } from '@/domain/ports';

export interface SchedulerCall {
  op: 'getPermission' | 'requestPermission' | 'listScheduled' | 'schedule' | 'cancel';
  keys?: string[];
  timeZone?: string;
}

export class FakeScheduler implements NotificationScheduler {
  permission: PermissionState;
  /** Esito di `requestPermission`. */
  requestResult: PermissionState = 'granted';
  readonly store = new Map<string, PlannedNotification>();
  readonly calls: SchedulerCall[] = [];
  /** Se impostato, l'operazione lancia (per provare la propagazione degli errori). */
  failOn: SchedulerCall['op'] | null = null;

  constructor(permission: PermissionState = 'granted') {
    this.permission = permission;
  }

  private rec(call: SchedulerCall): void {
    this.calls.push(call);
    if (this.failOn === call.op) throw new Error(`scheduler: ${call.op} fallita`);
  }

  async getPermission(): Promise<PermissionState> {
    this.rec({ op: 'getPermission' });
    return this.permission;
  }

  async requestPermission(): Promise<PermissionState> {
    this.rec({ op: 'requestPermission' });
    this.permission = this.requestResult;
    return this.permission;
  }

  async listScheduled(): Promise<{ key: string; hash: string }[]> {
    this.rec({ op: 'listScheduled' });
    return [...this.store.values()].map((n) => ({ key: n.key, hash: n.hash }));
  }

  async schedule(items: PlannedNotification[], timeZone: string): Promise<void> {
    this.rec({ op: 'schedule', keys: items.map((i) => i.key), timeZone });
    for (const i of items) this.store.set(i.key, i);
  }

  async cancel(keys: string[]): Promise<void> {
    this.rec({ op: 'cancel', keys });
    for (const k of keys) this.store.delete(k);
  }

  /** Chiamate che modificano o interrogano lo stato del sistema (esclude i permessi). */
  get systemCalls(): SchedulerCall[] {
    return this.calls.filter((c) => c.op === 'listScheduled' || c.op === 'schedule' || c.op === 'cancel');
  }

  resetCalls(): void {
    this.calls.length = 0;
  }

  /** Notifiche programmate, in ordine di data/ora/chiave. */
  scheduledSorted(): PlannedNotification[] {
    return [...this.store.values()].sort((a, b) => `${a.date}T${a.time}${a.key}`.localeCompare(`${b.date}T${b.time}${b.key}`));
  }
}
