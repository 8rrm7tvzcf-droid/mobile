// Tipi pubblici dei veicoli (F-01, F-02, F-05). Nomi in camelCase; denaro in centesimi, km interi, date 'YYYY-MM-DD'.
import type { LocalDate } from '@/domain/ports';
import type { CurrentKm } from '@/domain/odometer';

export const POWERTRAINS = ['ice', 'mhev', 'hev', 'phev', 'bev', 'fcev'] as const;
export type Powertrain = (typeof POWERTRAINS)[number];

export const PRIMARY_FUELS = ['petrol', 'diesel', 'lpg', 'cng', 'electric', 'hydrogen'] as const;
export type PrimaryFuel = (typeof PRIMARY_FUELS)[number];

/** Alimentazione secondaria: benzina+GPL, benzina+metano (anche a parti invertite) e ibrida plug-in. */
export const SECONDARY_FUELS = ['petrol', 'lpg', 'cng', 'electric'] as const;
export type SecondaryFuel = (typeof SECONDARY_FUELS)[number];

export const TRANSMISSIONS = ['manual', 'automatic', 'cvt', 'dct', 'other'] as const;
export type Transmission = (typeof TRANSMISSIONS)[number];

export const VEHICLE_STATUSES = ['active', 'sold', 'scrapped', 'archived'] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

/** Dati dell'auto in ingresso (aggiunta e modifica). Obbligatori solo marca, modello e alimentazione primaria. */
export interface VehicleInput {
  nickname?: string | null;
  /** Normalizzata (maiuscolo, senza spazi). Una targa gia' presente in un'altra auto non eliminata da' DUPLICATE_PLATE. */
  plate?: string | null;
  /** Default 'IT'. Con un altro Paese la targa non e' controllata sul formato italiano. */
  plateCountry?: string | null;
  /** 17 caratteri senza I, O, Q; il check digit non si impone (Europa). */
  vin?: string | null;
  make: string;
  model: string;
  trim?: string | null;
  modelYear?: number | null;
  firstRegistrationOn?: LocalDate | null;
  /** Default ricavato dall'alimentazione (elettrica -> bev, idrogeno -> fcev, +elettrica -> phev, altrimenti ice). */
  powertrain?: Powertrain;
  fuelPrimary: PrimaryFuel;
  fuelSecondary?: SecondaryFuel | null;
  engineCc?: number | null;
  powerKw?: number | null;
  euroClass?: string | null;
  color?: string | null;
  transmission?: Transmission | null;
  tankCapacityMl?: number | null;
  /** Default: l'impostazione `units.distance`. */
  distanceUnit?: 'km' | 'mi';
  annualKmEstimate?: number | null;
  purchaseOn?: LocalDate | null;
  purchaseKm?: number | null;
  purchasePriceCents?: number | null;
  notes?: string | null;
}

export interface AddVehicleInput extends VehicleInput {
  /** Km attuali: se presenti creano la prima lettura dell'odometro (provenienza «Inserito a mano»). */
  initialKm?: number | null;
  /** Data della lettura iniziale (default: oggi). */
  initialKmOn?: LocalDate;
}

/** Modifica parziale: i campi omessi non cambiano, `null` svuota un campo facoltativo. */
export type UpdateVehicleInput = Partial<VehicleInput>;

export interface Vehicle {
  id: string;
  nickname: string | null;
  /** Soprannome, altrimenti «Marca Modello». */
  displayName: string;
  plate: string | null;
  plateCountry: string;
  vin: string | null;
  make: string;
  model: string;
  trim: string | null;
  modelYear: number | null;
  firstRegistrationOn: LocalDate | null;
  powertrain: Powertrain;
  fuelPrimary: PrimaryFuel;
  fuelSecondary: SecondaryFuel | null;
  engineCc: number | null;
  powerKw: number | null;
  euroClass: string | null;
  color: string | null;
  transmission: Transmission | null;
  tankCapacityMl: number | null;
  distanceUnit: 'km' | 'mi';
  annualKmEstimate: number | null;
  purchaseOn: LocalDate | null;
  purchaseKm: number | null;
  purchasePriceCents: number | null;
  status: VehicleStatus;
  soldOn: LocalDate | null;
  soldKm: number | null;
  soldPriceCents: number | null;
  notes: string | null;
  sortOrder: number;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  /** Istante in cui e' finita nel cestino (null se l'auto non e' eliminata). */
  deletedAt: string | null;
}

export interface VehicleDetail extends Vehicle {
  /** Ultima lettura valida con provenienza (null se non ci sono letture). */
  currentKm: CurrentKm | null;
}

/** Riga dell'elenco del garage (S-11). */
export interface VehicleSummary {
  id: string;
  displayName: string;
  nickname: string | null;
  plate: string | null;
  make: string;
  model: string;
  modelYear: number | null;
  powertrain: Powertrain;
  fuelPrimary: PrimaryFuel;
  fuelSecondary: SecondaryFuel | null;
  status: VehicleStatus;
  /** Un'auto non attiva (venduta, rottamata, archiviata) non genera promemoria ne' notifiche. */
  isActive: boolean;
  isDemo: boolean;
  distanceUnit: 'km' | 'mi';
  sortOrder: number;
  currentKm: CurrentKm | null;
}

export interface ListVehiclesOptions {
  /** Default: tutti gli stati. */
  statuses?: readonly VehicleStatus[];
  /** Default true. */
  includeDemo?: boolean;
}

export interface ArchiveVehicleInput {
  status: 'sold' | 'scrapped' | 'archived';
  /** Solo per venduta/rottamata. Default: oggi. */
  soldOn?: LocalDate;
  soldKm?: number | null;
  soldPriceCents?: number | null;
}

export interface TrashedVehicle {
  id: string;
  displayName: string;
  plate: string | null;
  deletedAt: string;
  /** Giorno dopo il quale il cestino la elimina definitivamente. */
  purgeOn: LocalDate;
  daysLeft: number;
}
