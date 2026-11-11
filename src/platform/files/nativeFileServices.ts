// FileServices per il TELEFONO (SPEC 8.4, tabella "Telefono"): expo-file-system, fflate, expo-crypto, expo-document-picker,
// expo-image-picker, expo-sharing. Le cartelle private sono sotto la cartella documenti dell'app: AppDirs contiene
// percorsi relativi ('attachments', 'backups', 'temp'), che FileStore risolve sotto la radice.
import type { Directory } from 'expo-file-system';
import type { FileServices } from '@/domain/ports';
import { createExpoFilePicker, type ExpoFilePickerOptions } from './expoFilePicker';
import { createExpoFileSharer } from './expoFileSharer';
import { createExpoFileStore, type ExpoFileStore } from './expoFileStore';
import { createHashService } from './hashService';
import { APP_DIRS } from './paths';
import { createZipCodec } from './zipCodec';

export interface NativeFileServices extends FileServices {
  files: ExpoFileStore;
}

export interface NativeFileServicesOptions {
  /** Radice dei percorsi relativi (default: la cartella documenti dell'app). */
  root?: Directory;
  picker?: ExpoFilePickerOptions;
}

/** Crea i servizi e le tre cartelle private (attachments, backups, temp) se mancano. */
export async function createNativeFileServices(opts: NativeFileServicesOptions = {}): Promise<NativeFileServices> {
  const files = createExpoFileStore(opts.root);
  const dirs = { ...APP_DIRS };
  for (const dir of [dirs.attachments, dirs.backups, dirs.temp]) await files.ensureDir(dir);
  return {
    files,
    zip: createZipCodec(),
    hash: createHashService(),
    dirs,
    picker: createExpoFilePicker(opts.picker),
    sharer: createExpoFileSharer((path) => files.resolveUri(path)),
  };
}
