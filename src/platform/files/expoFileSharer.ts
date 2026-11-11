// Porta FileSharer sul telefono: foglio di condivisione di sistema con expo-sharing.
// `resolveUri` trasforma un percorso del FileStore in un URI `file://` assoluto (ExpoFileStore.resolveUri).
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import type { FileSharer } from '@/domain/ports';
import { mimeToUti } from './paths';

export function createExpoFileSharer(resolveUri: (path: string) => string): FileSharer {
  return {
    async shareFile(path, mimeType, title) {
      if (!(await isAvailableAsync())) throw new Error('La condivisione dei file non e\' disponibile su questo dispositivo.');
      const uti = mimeToUti(mimeType);
      await shareAsync(resolveUri(path), { mimeType, dialogTitle: title, ...(uti ? { UTI: uti } : {}) });
    },
  };
}
