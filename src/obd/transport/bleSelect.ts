// Selezione del servizio GATT e delle caratteristiche (notify / write) dei BLE ELM327 (OBD §4, SPEC 8.7).
// Non esiste un UUID unico: si decide dalle PROPRIETA' (alcune fonti invertono FFF1/FFF2), provando prima
// una lista di servizi noti e poi, in modo 'greedy', qualunque servizio non standard con una caratteristica
// notify e una write. Puro (nessun import): testabile senza BLE.

export interface KnownService {
  /** UUID normalizzato (16 bit in forma breve). */
  uuid: string;
  name: string;
  /** Livello di verifica della fonte (OBD §4): false = ipotesi da validare con l'adattatore reale. */
  verified: boolean;
}

/** Servizi noti, nell'ordine di prova. FFF0/FFE0/18F0/Nordic UART come da SPEC 8.7; poi le ipotesi non verificate. */
export const KNOWN_BLE_SERVICES: readonly KnownService[] = [
  { uuid: 'fff0', name: 'OBDLink CX, Veepeak e BLE generici (FFF1 notify, FFF2 write)', verified: true },
  { uuid: 'ffe0', name: 'Stile HM-10 / CC2541 (FFE1 write senza risposta + notify)', verified: true },
  { uuid: '18f0', name: 'Vgate iCar Pro BLE (2AF0 notify, 2AF1 write)', verified: true },
  { uuid: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', name: 'Nordic UART Service', verified: false },
  // [DA VERIFICARE] nessuna fonte indipendente (verifica del 2026-10-07): trattati come ipotesi.
  { uuid: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', name: 'Vgate iCar (iOS, CoreBluetooth)', verified: false },
  { uuid: '49535343-fe7d-4ae5-8fa9-9fafd205e455', name: 'ISSC / Microchip transparent UART', verified: false },
];

/** Servizi standard che non portano dati OBD (Generic Access, Generic Attribute, Device Information, Battery...). */
const STANDARD_SERVICES = new Set(['1800', '1801', '180a', '180f', 'fef5']);

export type BleProp = 'notify' | 'indicate' | 'write' | 'writeWithoutResponse' | 'read';

export interface BleCharacteristic {
  service: string;
  characteristic: string;
  /** Proprieta' come le restituisce react-native-ble-manager: oggetto {Notify: 'Notify', ...} o lista di nomi. */
  properties: readonly string[] | Readonly<Record<string, unknown>> | null | undefined;
}

export type BleWriteType = 'withResponse' | 'withoutResponse';

export interface BleConfig {
  /** UUID come restituiti dalla libreria (da usare nelle chiamate). */
  service: string;
  notify: string;
  write: string;
  writeType: BleWriteType;
  /** Notifiche o indicazioni sulla caratteristica di ricezione. */
  notifyMode: 'notify' | 'indicate';
  origin: 'saved' | 'known' | 'greedy';
}

/** Configurazione riuscita da ricordare per adattatore (id del dispositivo). */
export interface SavedBleConfig {
  service: string;
  notify: string;
  write: string;
  writeType: BleWriteType;
}

/**
 * UUID in forma confrontabile: minuscolo; la forma a 128 bit del Bluetooth SIG (0000XXXX-0000-1000-8000-
 * 00805F9B34FB) e quella a 32 bit diventano la forma breve a 16 bit; gli altri restano a 128 bit.
 */
export function normalizeUuid(uuid: string): string {
  const u = uuid.trim().toLowerCase().replace(/^0x/, '');
  const m = /^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/.exec(u);
  if (m) return m[1];
  if (/^[0-9a-f]{4}$/.test(u)) return u;
  if (/^[0-9a-f]{8}$/.test(u) && u.startsWith('0000')) return u.slice(4);
  return u;
}

/** Proprieta' in una forma unica, qualunque sia il formato della libreria. */
export function flattenProperties(p: BleCharacteristic['properties']): Set<BleProp> {
  const names: string[] = [];
  if (Array.isArray(p)) names.push(...(p as string[]));
  else if (p && typeof p === 'object') {
    for (const [k, v] of Object.entries(p)) {
      names.push(k);
      if (typeof v === 'string') names.push(v);
    }
  }
  const out = new Set<BleProp>();
  for (const raw of names) {
    const n = String(raw).replace(/[^a-z]/gi, '').toLowerCase();
    if (n === 'notify') out.add('notify');
    else if (n === 'indicate') out.add('indicate');
    else if (n === 'write') out.add('write');
    else if (n === 'writewithoutresponse') out.add('writeWithoutResponse');
    else if (n === 'read') out.add('read');
  }
  return out;
}

interface Norm {
  raw: BleCharacteristic;
  service: string;
  char: string;
  props: Set<BleProp>;
}

function canNotify(c: Norm): boolean {
  return c.props.has('notify') || c.props.has('indicate');
}

function canWrite(c: Norm): boolean {
  return c.props.has('write') || c.props.has('writeWithoutResponse');
}

function writeTypes(c: Norm): BleWriteType[] {
  const out: BleWriteType[] = [];
  if (c.props.has('writeWithoutResponse')) out.push('withoutResponse'); // preferita: piu' throughput
  if (c.props.has('write')) out.push('withResponse');
  return out;
}

/**
 * Candidati ordinati: (1) configurazione salvata se ancora valida, (2) servizi noti nell'ordine della lista,
 * (3) servizi non standard con almeno una caratteristica notify e una write (greedy). Per ogni coppia
 * notify/write la write senza risposta e' preferita, seguita dalla variante con risposta.
 * Il chiamante abilita le notifiche PRIMA di scrivere e verifica con ATZ (nessun '>' in 3 s -> successivo).
 */
export function selectBleConfigs(chars: readonly BleCharacteristic[], saved?: SavedBleConfig): BleConfig[] {
  const norm: Norm[] = chars.map((raw) => ({ raw, service: normalizeUuid(raw.service), char: normalizeUuid(raw.characteristic), props: flattenProperties(raw.properties) }));
  const services: string[] = [];
  for (const c of norm) if (!services.includes(c.service)) services.push(c.service);

  const known = KNOWN_BLE_SERVICES.map((k) => k.uuid).filter((u) => services.includes(u));
  const greedy = services.filter((s) => !known.includes(s) && !STANDARD_SERVICES.has(s));

  const out: BleConfig[] = [];
  const add = (cfg: BleConfig) => {
    if (!out.some((o) => o.service === cfg.service && o.notify === cfg.notify && o.write === cfg.write && o.writeType === cfg.writeType)) out.push(cfg);
  };

  const forService = (svc: string, origin: 'known' | 'greedy') => {
    const inSvc = norm.filter((c) => c.service === svc);
    const notifyChars = inSvc.filter(canNotify).sort((a, b) => Number(b.props.has('notify')) - Number(a.props.has('notify')));
    const writeChars = inSvc.filter(canWrite);
    if (notifyChars.length === 0 || writeChars.length === 0) return;
    const pairs: { n: Norm; w: Norm }[] = [];
    for (const n of notifyChars) {
      // prima le caratteristiche di scrittura diverse da quella di ricezione (FFF1 notify / FFF2 write), poi la stessa (HM-10)
      const separate = writeChars.filter((w) => w.char !== n.char);
      const same = writeChars.filter((w) => w.char === n.char);
      for (const w of [...separate, ...same]) pairs.push({ n, w });
    }
    const primary: BleConfig[] = [];
    const alternates: BleConfig[] = [];
    for (const { n, w } of pairs.slice(0, 4)) {
      const wts = writeTypes(w);
      wts.forEach((wt, i) => {
        const cfg: BleConfig = {
          service: n.raw.service,
          notify: n.raw.characteristic,
          write: w.raw.characteristic,
          writeType: wt,
          notifyMode: n.props.has('notify') ? 'notify' : 'indicate',
          origin,
        };
        (i === 0 ? primary : alternates).push(cfg);
      });
    }
    primary.forEach(add);
    alternates.forEach(add);
  };

  for (const s of known) forService(s, 'known');
  for (const s of greedy) forService(s, 'greedy');

  if (saved) {
    const idx = out.findIndex(
      (o) => normalizeUuid(o.service) === normalizeUuid(saved.service) && normalizeUuid(o.notify) === normalizeUuid(saved.notify) && normalizeUuid(o.write) === normalizeUuid(saved.write) && o.writeType === saved.writeType,
    );
    if (idx >= 0) {
      const [hit] = out.splice(idx, 1);
      out.unshift({ ...hit, origin: 'saved' });
    }
  }
  return out;
}
