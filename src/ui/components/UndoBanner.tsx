// Avviso con "Annulla" dopo aver salvato o eliminato un rifornimento, una spesa, un intervento, un controllo o una polizza. Sparisce da solo dopo qualche secondo.
import { useEffect, useState, type ReactNode } from 'react';
import { useApp } from '@/bootstrap';
import { removeAttachment, restoreAttachment } from '@/usecases/attachments';
import { deleteExpense, restoreExpense } from '@/usecases/expenses';
import { addFluidCheck, deleteFluidCheck, type AddFluidCheckInput } from '@/usecases/fluids';
import { deleteFuelLog, restoreFuelLog } from '@/usecases/fuel';
import { deletePolicy, restorePolicy } from '@/usecases/insurance';
import { deleteServiceRecord, restoreServiceRecord } from '@/usecases/services';
import { useBusy } from '../hooks/useBusy';
import { clearUndo, useUndo, type UndoEntry, type UndoKind } from '../hooks/undo';
import { it } from '../i18n/it';
import { Banner } from './Banner';

type UndoDeps = ReturnType<typeof useApp>['deps'];

/** Esegue l'annullamento della voce: elimina quella appena aggiunta o ripristina quella eliminata. */
async function perform(deps: UndoDeps, e: UndoEntry): Promise<{ ok: boolean; warning: string | null }> {
  if (e.mode === 'added') {
    switch (e.kind) {
      case 'fuel':
        return { ok: (await deleteFuelLog(deps, e.itemId)).ok, warning: null };
      case 'expense':
        return { ok: (await deleteExpense(deps, e.itemId)).ok, warning: null };
      case 'service':
        return { ok: (await deleteServiceRecord(deps, e.itemId)).ok, warning: null };
      case 'fluid':
        return { ok: (await deleteFluidCheck(deps, e.itemId)).ok, warning: null };
      case 'attachment':
        return { ok: (await removeAttachment(deps, e.itemId)).ok, warning: null };
      default:
        return { ok: (await deletePolicy(deps, e.itemId)).ok, warning: null };
    }
  }
  switch (e.kind) {
    case 'fuel': {
      const res = await restoreFuelLog(deps, e.itemId);
      return { ok: res.ok, warning: res.ok && res.value.warnings.length > 0 ? res.value.warnings.join(' ') : null };
    }
    case 'expense':
      return { ok: (await restoreExpense(deps, e.itemId)).ok, warning: null };
    case 'service': {
      const res = await restoreServiceRecord(deps, e.itemId, { onOdometerConflict: 'skip_km' });
      return { ok: res.ok, warning: res.ok && res.value.warnings.length > 0 ? res.value.warnings.map((w) => w.message).join(' ') : null };
    }
    case 'fluid':
      return { ok: (await addFluidCheck(deps, e.payload as AddFluidCheckInput)).ok, warning: null };
    case 'attachment':
      return { ok: (await restoreAttachment(deps, e.itemId)).ok, warning: null };
    default:
      return { ok: (await restorePolicy(deps, e.itemId)).ok, warning: null };
  }
}

const VISIBLE_MS = 12000;
const NOTICE_MS = 5000;

export interface UndoBannerProps {
  /** Se indicato, il promemoria si vede solo per questa auto. */
  vehicleId?: string;
  /** Se indicato, si vede solo il promemoria di questo tipo (per esempio gli allegati nei dettagli). */
  kind?: UndoKind;
}

export function UndoBanner({ vehicleId, kind }: UndoBannerProps): ReactNode {
  const { deps } = useApp();
  const entry = useUndo();
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warning' | 'danger'; text: string } | null>(null);
  const busy = useBusy();

  useEffect(() => {
    if (!entry) return;
    const t = setTimeout(clearUndo, VISIBLE_MS);
    return () => clearTimeout(t);
  }, [entry]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  const run = (e: UndoEntry): void => {
    void busy.run(async () => {
      try {
        const { ok, warning } = await perform(deps, e);
        clearUndo();
        setNotice(ok ? (warning ? { tone: 'warning', text: warning } : { tone: 'ok', text: it.undo.restored }) : { tone: 'danger', text: it.undo.failed });
      } catch {
        clearUndo();
        setNotice({ tone: 'danger', text: it.undo.failed });
      }
    });
  };

  if (notice) return <Banner tone={notice.tone} title={notice.text} />;
  if (!entry || (vehicleId !== undefined && entry.vehicleId !== vehicleId) || (kind !== undefined && entry.kind !== kind)) return null;
  return <Banner tone="info" icon="undo" title={entry.message} actionLabel={it.undo.action} onAction={() => run(entry)} />;
}
