// Elenco ordinato delle migrazioni dell'app: versioni 1..N consecutive, solo in avanti.
// Una migrazione rilasciata non si modifica MAI (il checksum in migrations_log lo rileva): se ne aggiunge una nuova.
import type { Migration } from '../types';
import { migration0001 } from './0001_init';

export const MIGRATIONS: readonly Migration[] = [migration0001];

/** Versione dello schema che questa build dell'app sa gestire. */
export const LATEST_SCHEMA_VERSION: number = MIGRATIONS.length;
