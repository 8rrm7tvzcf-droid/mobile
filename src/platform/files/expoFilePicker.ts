// Porta FilePicker sul telefono: documenti con expo-document-picker (copia nella cache dell'app, quindi leggibile subito
// con FileStore.read) e immagini con expo-image-picker (galleria e fotocamera).
// Annullato dall'utente o permesso della fotocamera negato -> null. Gli errori tecnici (modulo assente, fotocamera non
// disponibile) NON si nascondono: la promessa viene rifiutata e il chiamante li mostra.
import { getDocumentAsync, type DocumentPickerAsset } from 'expo-document-picker';
import {
  launchCameraAsync,
  launchImageLibraryAsync,
  requestCameraPermissionsAsync,
  type ImagePickerAsset,
  type ImagePickerOptions,
} from 'expo-image-picker';
import type { FilePicker, PickedFile } from '@/domain/ports';
import { baseName, guessMimeType } from './paths';

/** Documento scelto -> PickedFile. Il nome manca raramente: in quel caso si ricava dall'URI. */
export function mapDocumentAsset(asset: Pick<DocumentPickerAsset, 'uri' | 'name' | 'size' | 'mimeType'>): PickedFile {
  const name = asset.name?.trim() || baseName(asset.uri) || 'documento';
  return {
    uri: asset.uri,
    name,
    mimeType: asset.mimeType ?? guessMimeType(name),
    size: typeof asset.size === 'number' ? asset.size : null,
  };
}

/** Immagine scelta o scattata -> PickedFile. Su Android la fotocamera puo' non dare un nome: si usa quello dell'URI. */
export function mapImageAsset(asset: Pick<ImagePickerAsset, 'uri' | 'fileName' | 'fileSize' | 'mimeType'>): PickedFile {
  const name = asset.fileName?.trim() || baseName(asset.uri) || 'foto.jpg';
  return {
    uri: asset.uri,
    name,
    mimeType: asset.mimeType ?? guessMimeType(name) ?? 'image/jpeg',
    size: typeof asset.fileSize === 'number' ? asset.fileSize : null,
  };
}

export interface ExpoFilePickerOptions {
  /** Qualita' JPEG 0-1 delle immagini (default 0.8: foto di ricevute leggere ma leggibili). */
  imageQuality?: number;
}

export function createExpoFilePicker(opts: ExpoFilePickerOptions = {}): FilePicker {
  const imageOptions: ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: false,
    allowsMultipleSelection: false,
    exif: false,
    quality: opts.imageQuality ?? 0.8,
  };
  return {
    async pickDocument({ types }) {
      const result = await getDocumentAsync({
        type: types.length > 0 ? types : '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return null;
      const asset = result.assets[0];
      return asset ? mapDocumentAsset(asset) : null;
    },
    async pickImage({ camera }) {
      if (camera) {
        const permission = await requestCameraPermissionsAsync();
        if (!permission.granted) return null;
      }
      // La galleria usa il selettore di sistema (Android Photo Picker, PHPicker su iOS): non chiede permessi.
      const result = camera ? await launchCameraAsync(imageOptions) : await launchImageLibraryAsync(imageOptions);
      if (result.canceled) return null;
      const asset = result.assets[0];
      return asset ? mapImageAsset(asset) : null;
    },
  };
}
