// Azioni di recupero dell'anteprima WEB: i dati sono solo di prova (IndexedDB del browser), quindi si possono azzerare.
import { createIndexedDbFileBackend } from '@/platform/files/indexedDbFileBackend';
import { createIndexedDbSnapshotStore } from './webPersistence';
import type { RecoveryAction } from './types';

export function getRecoveryActions(): RecoveryAction[] {
  return [
    {
      id: 'reset-web-preview-data',
      label: "Azzera i dati dell'anteprima",
      warning: "Cancella i dati di prova salvati in questo browser e riparte da zero. Sul telefono questo non succede mai.",
      async run() {
        await createIndexedDbSnapshotStore().clear();
        await createIndexedDbFileBackend().clear();
        if (typeof window !== 'undefined') window.location.reload();
      },
    },
  ];
}
