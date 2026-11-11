// Tipi pubblici delle spese (F-41; SPEC 6.3.8 S-23): categorie di sistema e personalizzate, registro e valori di scrittura.
import type { LocalDate } from '@/domain/ports';

/** Una categoria di spesa: le 13 di sistema (id `sys_*`, non modificabili) e quelle create dall'utente (ULID). */
export interface ExpenseCategory {
  id: string;
  name: string;
  icon: string | null;
  isSystem: boolean;
  sortOrder: number;
}

export interface CreateExpenseCategoryInput {
  /** 1-40 caratteri, diverso (senza badare alle maiuscole) dalle altre categorie. */
  name: string;
  /** Nome dell'icona (max 40 caratteri). */
  icon?: string | null;
}

export interface UpdateExpenseCategoryInput {
  name?: string;
  icon?: string | null;
}

export interface DeleteExpenseCategoryOptions {
  /** Obbligatoria se la categoria e' usata da spese: le spese vengono spostate su questa categoria. */
  moveToCategoryId?: string;
}

export interface ExpenseEntry {
  id: string;
  vehicleId: string;
  spentOn: LocalDate;
  categoryId: string;
  categoryName: string;
  categoryIcon: string | null;
  isSystemCategory: boolean;
  /** Centesimi interi. */
  amountCents: number;
  description: string | null;
  vendor: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AddExpenseInput {
  vehicleId: string;
  /** Default: oggi. */
  spentOn?: LocalDate;
  categoryId: string;
  /** Centesimi, maggiore di zero: 12,50 EUR = 1250. */
  amountCents: number;
  /** Max 200 caratteri. */
  description?: string | null;
  /** Esercente o fornitore, max 80 caratteri. */
  vendor?: string | null;
  notes?: string | null;
}

/** Modifica parziale: i campi non indicati restano invariati. */
export interface UpdateExpenseInput {
  spentOn?: LocalDate;
  categoryId?: string;
  amountCents?: number;
  description?: string | null;
  vendor?: string | null;
  notes?: string | null;
}

export interface ExpenseWriteResult {
  expense: ExpenseEntry;
  /**
   * Avvisi non bloccanti, in italiano: es. «Esiste già un intervento dello stesso importo nello stesso giorno»
   * (un tagliando da 210 EUR non deve diventare anche una spesa: i costi non si duplicano).
   */
  warnings: string[];
}

export interface ListExpensesOptions {
  /** Solo questa categoria. */
  categoryId?: string;
  /** Default: dalla piu' recente. */
  order?: 'desc' | 'asc';
  limit?: number;
  offset?: number;
}
