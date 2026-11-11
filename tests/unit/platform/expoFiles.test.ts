// Adattatori nativi dei file con i moduli Expo simulati: expo-file-system (File/Directory in memoria), expo-crypto,
// expo-document-picker, expo-image-picker ed expo-sharing. Si prova la mappatura e il comportamento, non il telefono.
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  state: { files: new Map<string, Uint8Array>(), dirs: new Set<string>() },
  digest: vi.fn(),
  getDocumentAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
  launchCameraAsync: vi.fn(),
  requestCameraPermissionsAsync: vi.fn(),
  isAvailableAsync: vi.fn(),
  shareAsync: vi.fn(),
}));

vi.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digest: mocks.digest }));
vi.mock('expo-document-picker', () => ({ getDocumentAsync: mocks.getDocumentAsync }));
vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: mocks.launchImageLibraryAsync,
  launchCameraAsync: mocks.launchCameraAsync,
  requestCameraPermissionsAsync: mocks.requestCameraPermissionsAsync,
}));
vi.mock('expo-sharing', () => ({ isAvailableAsync: mocks.isAvailableAsync, shareAsync: mocks.shareAsync }));
vi.mock('expo-file-system', () => {
  const { files, dirs } = mocks.state;
  type Loc = string | { uri: string };
  const uriOf = (a: Loc, b?: string): string => {
    const base = typeof a === 'string' ? a : a.uri;
    return (b === undefined ? base : `${base.replace(/\/+$/, '')}/${b}`).replace(/\/+$/, '');
  };
  const parentOf = (uri: string): string => uri.slice(0, uri.lastIndexOf('/'));
  const nameOf = (uri: string): string => uri.slice(uri.lastIndexOf('/') + 1);
  const mkdirs = (uri: string): void => {
    for (let u = uri; u.length > 'file://'.length; u = parentOf(u)) dirs.add(u);
  };
  class Directory {
    readonly uri: string;
    constructor(a: Loc, b?: string) {
      this.uri = uriOf(a, b);
    }
    get exists(): boolean {
      return dirs.has(this.uri);
    }
    get name(): string {
      return nameOf(this.uri);
    }
    get parentDirectory(): Directory {
      return new Directory(parentOf(this.uri));
    }
    create(opts: { intermediates?: boolean; idempotent?: boolean } = {}): void {
      if (this.exists && !opts.idempotent) throw new Error('la cartella esiste gia');
      if (!opts.intermediates && !dirs.has(parentOf(this.uri))) throw new Error('manca la cartella superiore');
      mkdirs(this.uri);
    }
    delete(): void {
      for (const d of [...dirs]) if (d === this.uri || d.startsWith(`${this.uri}/`)) dirs.delete(d);
      for (const f of [...files.keys()]) if (f.startsWith(`${this.uri}/`)) files.delete(f);
    }
    list(): Array<{ name: string; uri: string }> {
      const prefix = `${this.uri}/`;
      const out = new Map<string, string>();
      for (const key of [...files.keys(), ...dirs]) {
        if (!key.startsWith(prefix)) continue;
        const first = key.slice(prefix.length).split('/', 1)[0] as string;
        out.set(first, `${prefix}${first}`);
      }
      return [...out].map(([name, uri]) => ({ name, uri }));
    }
  }
  class File {
    readonly uri: string;
    constructor(a: Loc, b?: string) {
      this.uri = uriOf(a, b);
    }
    get exists(): boolean {
      return files.has(this.uri);
    }
    get name(): string {
      return nameOf(this.uri);
    }
    get parentDirectory(): Directory {
      return new Directory(parentOf(this.uri));
    }
    create(opts: { overwrite?: boolean; intermediates?: boolean } = {}): void {
      if (this.exists && !opts.overwrite) throw new Error('il file esiste gia');
      if (!dirs.has(parentOf(this.uri))) {
        if (!opts.intermediates) throw new Error('manca la cartella superiore');
        mkdirs(parentOf(this.uri));
      }
      files.set(this.uri, new Uint8Array(0));
    }
    write(bytes: Uint8Array): void {
      if (!this.exists) throw new Error('il file non esiste');
      files.set(this.uri, bytes.slice());
    }
    async bytes(): Promise<Uint8Array> {
      const b = files.get(this.uri);
      if (!b) throw new Error(`file non trovato: ${this.uri}`);
      return b.slice();
    }
    delete(): void {
      if (!this.exists) throw new Error('il file non esiste');
      files.delete(this.uri);
    }
  }
  const document = new Directory('file:///data/user/0/app/files');
  dirs.add(document.uri);
  return { File, Directory, Paths: { document } };
});

import type { PickedFile } from '@/domain/ports';
import { createExpoFilePicker, mapDocumentAsset, mapImageAsset } from '@/platform/files/expoFilePicker';
import { createExpoFileSharer } from '@/platform/files/expoFileSharer';
import { createExpoFileStore, toFileUri } from '@/platform/files/expoFileStore';
import { createNativeFileServices } from '@/platform/files/nativeFileServices';

const ROOT = 'file:///data/user/0/app/files';
const bytes = (...n: number[]): Uint8Array => Uint8Array.from(n);

beforeEach(() => {
  mocks.state.files.clear();
  mocks.state.dirs.clear();
  mocks.state.dirs.add(ROOT);
  mocks.digest.mockReset();
  mocks.digest.mockImplementation(async (_algo: string, data: Uint8Array) => {
    const b = createHash('sha256').update(data).digest();
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  });
  for (const m of [mocks.getDocumentAsync, mocks.launchImageLibraryAsync, mocks.launchCameraAsync, mocks.requestCameraPermissionsAsync, mocks.isAvailableAsync, mocks.shareAsync]) {
    m.mockReset();
  }
});

describe('FileStore su expo-file-system', () => {
  it('toFileUri: i percorsi assoluti diventano URI, URI e percorsi relativi restano', () => {
    expect(toFileUri('/data/x/y.pdf')).toBe('file:///data/x/y.pdf');
    expect(toFileUri('file:///data/x/y.pdf')).toBe('file:///data/x/y.pdf');
    expect(toFileUri('attachments/y.pdf')).toBe('attachments/y.pdf');
  });

  it('write crea le cartelle mancanti; i percorsi relativi stanno sotto la radice (documenti dell\'app)', async () => {
    const fs = createExpoFileStore();
    await fs.write('attachments/01ABC.pdf', bytes(1, 2, 3));
    expect(mocks.state.files.has(`${ROOT}/attachments/01ABC.pdf`)).toBe(true);
    expect(mocks.state.dirs.has(`${ROOT}/attachments`)).toBe(true);
    expect(Array.from(await fs.read('attachments/01ABC.pdf'))).toEqual([1, 2, 3]);
  });

  it('write sopra un file esistente lo sostituisce; read restituisce Uint8Array', async () => {
    const fs = createExpoFileStore();
    await fs.write('a.bin', bytes(1, 2, 3));
    await fs.write('a.bin', bytes(9));
    const out = await fs.read('a.bin');
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out)).toEqual([9]);
  });

  it('URI file:// e percorsi assoluti si usano cosi\' come sono, fuori dalla radice', async () => {
    const fs = createExpoFileStore();
    await fs.write('file:///data/user/0/app/cache/DocumentPicker/x.pdf', bytes(5));
    expect(Array.from(await fs.read('file:///data/user/0/app/cache/DocumentPicker/x.pdf'))).toEqual([5]);
    expect(Array.from(await fs.read('/data/user/0/app/cache/DocumentPicker/x.pdf'))).toEqual([5]);
    expect(await fs.exists('/data/user/0/app/cache/DocumentPicker/x.pdf')).toBe(true);
  });

  it('exists vale per file e cartelle; remove cancella file o cartella intera e ignora i percorsi assenti', async () => {
    const fs = createExpoFileStore();
    await fs.write('temp/x/a.bin', bytes(1));
    await fs.write('temp/x/b.bin', bytes(2));
    expect(await fs.exists('temp/x/a.bin')).toBe(true);
    expect(await fs.exists('temp/x')).toBe(true);
    expect(await fs.exists('temp/y')).toBe(false);
    await fs.remove('temp/x/a.bin');
    expect(await fs.exists('temp/x/a.bin')).toBe(false);
    expect(await fs.exists('temp/x/b.bin')).toBe(true);
    await fs.remove('temp/x');
    expect(await fs.exists('temp/x')).toBe(false);
    await expect(fs.remove('temp/non-esiste')).resolves.toBeUndefined();
  });

  it('list restituisce i NOMI delle voci; una cartella assente da []', async () => {
    const fs = createExpoFileStore();
    await fs.write('temp/export-1/MyGarage.zip', bytes(1));
    await fs.write('temp/foto.jpg', bytes(2));
    expect((await fs.list('temp')).sort()).toEqual(['export-1', 'foto.jpg']);
    expect(await fs.list('mai-creata')).toEqual([]);
  });

  it('sha256 passa da expo-crypto con SHA-256 e restituisce 64 caratteri esadecimali', async () => {
    const fs = createExpoFileStore();
    await fs.write('a.txt', new TextEncoder().encode('abc'));
    expect(await fs.sha256('a.txt')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(mocks.digest).toHaveBeenCalledWith('SHA-256', expect.any(Uint8Array));
    await expect(fs.sha256('manca.txt')).rejects.toThrow(/non trovato/);
  });

  it("ensureDir e' idempotente; resolveUri da l'URI assoluto", async () => {
    const fs = createExpoFileStore();
    await fs.ensureDir('backups');
    await fs.ensureDir('backups');
    expect(mocks.state.dirs.has(`${ROOT}/backups`)).toBe(true);
    expect(fs.resolveUri('backups/pre-v1.db')).toBe(`${ROOT}/backups/pre-v1.db`);
    expect(fs.resolveUri('/data/x/y.zip')).toBe('file:///data/x/y.zip');
    expect(fs.resolveUri('file:///data/x/y.zip')).toBe('file:///data/x/y.zip');
  });

  it("un percorso relativo che esce dalla radice ('..') e' un errore, per ogni operazione", async () => {
    const fs = createExpoFileStore();
    await expect(fs.write('../fuori.txt', bytes(1))).rejects.toThrow(/non valido/);
    await expect(fs.read('attachments/../../x')).rejects.toThrow(/non valido/);
    await expect(fs.remove('../x')).rejects.toThrow(/non valido/);
    await expect(fs.exists('../x')).rejects.toThrow(/non valido/);
    await expect(fs.list('../x')).rejects.toThrow(/non valido/);
    await expect(fs.ensureDir('../x')).rejects.toThrow(/non valido/);
  });
});

describe('FilePicker nativo: mappatura', () => {
  it('mapDocumentAsset: nome, tipo e dimensione dal documento', () => {
    expect(mapDocumentAsset({ uri: 'file:///cache/DocumentPicker/u-1.pdf', name: 'Libretto.pdf', size: 1234, mimeType: 'application/pdf' })).toEqual({
      uri: 'file:///cache/DocumentPicker/u-1.pdf',
      name: 'Libretto.pdf',
      mimeType: 'application/pdf',
      size: 1234,
    });
  });
  it("mapDocumentAsset: senza tipo lo deduce dall'estensione, senza dimensione da null, senza nome usa l'URI", () => {
    expect(mapDocumentAsset({ uri: 'file:///cache/DocumentPicker/Backup%20Clio.zip', name: '' })).toEqual({
      uri: 'file:///cache/DocumentPicker/Backup%20Clio.zip',
      name: 'Backup Clio.zip',
      mimeType: 'application/zip',
      size: null,
    });
    expect(mapDocumentAsset({ uri: 'file:///cache/x.boh', name: 'x.boh' }).mimeType).toBeNull();
  });
  it("mapImageAsset: usa nome, tipo e dimensione dell'immagine", () => {
    expect(mapImageAsset({ uri: 'file:///cache/ImagePicker/abc.jpg', fileName: 'IMG_0012.JPG', mimeType: 'image/jpeg', fileSize: 98765 })).toEqual({
      uri: 'file:///cache/ImagePicker/abc.jpg',
      name: 'IMG_0012.JPG',
      mimeType: 'image/jpeg',
      size: 98765,
    });
  });
  it("mapImageAsset: la fotocamera puo' non dare nome, tipo e dimensione", () => {
    expect(mapImageAsset({ uri: 'file:///cache/ImagePicker/9f8e.png', fileName: null })).toEqual({
      uri: 'file:///cache/ImagePicker/9f8e.png',
      name: '9f8e.png',
      mimeType: 'image/png',
      size: null,
    });
    expect(mapImageAsset({ uri: 'file:///cache/ImagePicker/senza-estensione' }).mimeType).toBe('image/jpeg');
  });
});

describe('FilePicker nativo: comportamento', () => {
  it('pickDocument: copia nella cache, un solo file, tipi MIME richiesti', async () => {
    mocks.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///cache/DocumentPicker/a.zip', name: 'MyGarage-2026-10-13.zip', size: 500, mimeType: 'application/zip', lastModified: 1 }],
    });
    const picked = await createExpoFilePicker().pickDocument({ types: ['application/zip', 'application/json'] });
    expect(mocks.getDocumentAsync).toHaveBeenCalledWith({ type: ['application/zip', 'application/json'], copyToCacheDirectory: true, multiple: false });
    expect(picked).toEqual<PickedFile>({ uri: 'file:///cache/DocumentPicker/a.zip', name: 'MyGarage-2026-10-13.zip', mimeType: 'application/zip', size: 500 });
  });

  it("pickDocument: senza tipi accetta qualunque documento; annullato o senza risultati -> null", async () => {
    mocks.getDocumentAsync.mockResolvedValue({ canceled: true, assets: null });
    expect(await createExpoFilePicker().pickDocument({ types: [] })).toBeNull();
    expect(mocks.getDocumentAsync).toHaveBeenCalledWith(expect.objectContaining({ type: '*/*' }));
    mocks.getDocumentAsync.mockResolvedValue({ canceled: false, assets: [] });
    expect(await createExpoFilePicker().pickDocument({ types: ['application/pdf'] })).toBeNull();
  });

  it('pickDocument: un errore tecnico non si nasconde', async () => {
    mocks.getDocumentAsync.mockRejectedValue(new Error('selettore non disponibile'));
    await expect(createExpoFilePicker().pickDocument({ types: [] })).rejects.toThrow('selettore non disponibile');
  });

  it('pickImage dalla galleria: nessuna richiesta di permessi, solo immagini, qualita\' 0.8, un solo file', async () => {
    mocks.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///cache/ImagePicker/p.jpg', width: 10, height: 10, fileName: 'ricevuta.jpg', mimeType: 'image/jpeg', fileSize: 4321 }],
    });
    const picked = await createExpoFilePicker().pickImage({ camera: false });
    expect(mocks.requestCameraPermissionsAsync).not.toHaveBeenCalled();
    expect(mocks.launchCameraAsync).not.toHaveBeenCalled();
    expect(mocks.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: ['images'], allowsMultipleSelection: false, allowsEditing: false, exif: false, quality: 0.8 }),
    );
    expect(picked).toEqual<PickedFile>({ uri: 'file:///cache/ImagePicker/p.jpg', name: 'ricevuta.jpg', mimeType: 'image/jpeg', size: 4321 });
  });

  it('pickImage: la qualita\' si puo\' cambiare; annullato -> null', async () => {
    mocks.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null });
    expect(await createExpoFilePicker({ imageQuality: 1 }).pickImage({ camera: false })).toBeNull();
    expect(mocks.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ quality: 1 }));
  });

  it('pickImage con fotocamera: permesso negato -> null senza aprire la fotocamera', async () => {
    mocks.requestCameraPermissionsAsync.mockResolvedValue({ granted: false, status: 'denied', canAskAgain: false });
    expect(await createExpoFilePicker().pickImage({ camera: true })).toBeNull();
    expect(mocks.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('pickImage con fotocamera: permesso concesso -> scatta e restituisce il file', async () => {
    mocks.requestCameraPermissionsAsync.mockResolvedValue({ granted: true, status: 'granted', canAskAgain: true });
    mocks.launchCameraAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/ImagePicker/cam.jpg', width: 1, height: 1 }] });
    const picked = await createExpoFilePicker().pickImage({ camera: true });
    expect(mocks.launchImageLibraryAsync).not.toHaveBeenCalled();
    expect(picked).toEqual<PickedFile>({ uri: 'file:///cache/ImagePicker/cam.jpg', name: 'cam.jpg', mimeType: 'image/jpeg', size: null });
  });

  it('pickImage con fotocamera: scatto annullato -> null; errore tecnico (nessuna fotocamera) -> rifiuto', async () => {
    mocks.requestCameraPermissionsAsync.mockResolvedValue({ granted: true });
    mocks.launchCameraAsync.mockResolvedValueOnce({ canceled: true, assets: null });
    expect(await createExpoFilePicker().pickImage({ camera: true })).toBeNull();
    mocks.launchCameraAsync.mockRejectedValueOnce(new Error('fotocamera non disponibile'));
    await expect(createExpoFilePicker().pickImage({ camera: true })).rejects.toThrow('fotocamera non disponibile');
  });

  it("il file scelto e' leggibile col FileStore (URI assoluto nella cache)", async () => {
    mocks.getDocumentAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///data/user/0/app/cache/DocumentPicker/z.pdf', name: 'z.pdf', lastModified: 1 }] });
    const fs = createExpoFileStore();
    await fs.write('file:///data/user/0/app/cache/DocumentPicker/z.pdf', bytes(4, 5, 6));
    const picked = await createExpoFilePicker().pickDocument({ types: ['application/pdf'] });
    expect(Array.from(await fs.read((picked as PickedFile).uri))).toEqual([4, 5, 6]);
  });
});

describe('FileSharer nativo', () => {
  const resolve = (p: string): string => `${ROOT}/${p}`;

  it("condivide l'URI risolto con tipo MIME, titolo e UTI di iOS", async () => {
    mocks.isAvailableAsync.mockResolvedValue(true);
    mocks.shareAsync.mockResolvedValue(undefined);
    await createExpoFileSharer(resolve).shareFile('temp/MyGarage-2026-10-13.zip', 'application/zip', 'Backup di MyGarage');
    expect(mocks.shareAsync).toHaveBeenCalledWith(`${ROOT}/temp/MyGarage-2026-10-13.zip`, {
      mimeType: 'application/zip',
      dialogTitle: 'Backup di MyGarage',
      UTI: 'public.zip-archive',
    });
  });

  it('un tipo MIME senza UTI noto non aggiunge UTI', async () => {
    mocks.isAvailableAsync.mockResolvedValue(true);
    await createExpoFileSharer(resolve).shareFile('temp/x.bin', 'application/x-boh', 'File');
    expect(mocks.shareAsync).toHaveBeenCalledWith(`${ROOT}/temp/x.bin`, { mimeType: 'application/x-boh', dialogTitle: 'File' });
  });

  it('se la condivisione non e\' disponibile lancia un errore chiaro e non apre nulla', async () => {
    mocks.isAvailableAsync.mockResolvedValue(false);
    await expect(createExpoFileSharer(resolve).shareFile('temp/x.zip', 'application/zip', 'x')).rejects.toThrow(/non e' disponibile/);
    expect(mocks.shareAsync).not.toHaveBeenCalled();
  });

  it('un errore del foglio di condivisione arriva al chiamante', async () => {
    mocks.isAvailableAsync.mockResolvedValue(true);
    mocks.shareAsync.mockRejectedValue(new Error('file inesistente'));
    await expect(createExpoFileSharer(resolve).shareFile('temp/x.zip', 'application/zip', 'x')).rejects.toThrow('file inesistente');
  });
});

describe('createNativeFileServices', () => {
  it('crea attachments, backups e temp sotto la cartella documenti e collega tutti i servizi', async () => {
    const fs = await createNativeFileServices();
    expect(fs.dirs).toEqual({ attachments: 'attachments', backups: 'backups', temp: 'temp' });
    for (const d of ['attachments', 'backups', 'temp']) expect(mocks.state.dirs.has(`${ROOT}/${d}`)).toBe(true);

    // stored_path del database = `${attachments}/<id>.<ext>`: lo stesso percorso funziona per scrivere, leggere, calcolare l'hash
    const stored = `${fs.dirs.attachments}/01ABC.pdf`;
    await fs.files.write(stored, new TextEncoder().encode('abc'));
    expect(await fs.files.sha256(stored)).toBe(await fs.hash.sha256Hex(new TextEncoder().encode('abc')));

    // ZIP vero: scrive nella cartella temporanea, rilegge e decomprime
    const zipped = fs.zip.zip([{ name: 'attachments/01ABC.pdf', bytes: await fs.files.read(stored) }]);
    await fs.files.write(`${fs.dirs.temp}/backup.zip`, zipped);
    const back = fs.zip.unzip(await fs.files.read(`${fs.dirs.temp}/backup.zip`));
    expect(new TextDecoder().decode(back[0]?.bytes)).toBe('abc');

    // la condivisione risolve i percorsi relativi sotto la radice
    mocks.isAvailableAsync.mockResolvedValue(true);
    await fs.sharer.shareFile(`${fs.dirs.temp}/backup.zip`, 'application/zip', 'Backup');
    expect(mocks.shareAsync).toHaveBeenCalledWith(`${ROOT}/temp/backup.zip`, expect.objectContaining({ mimeType: 'application/zip' }));
  });

  it('ripetere la creazione non fallisce (le cartelle esistono gia\')', async () => {
    await createNativeFileServices();
    await expect(createNativeFileServices()).resolves.toBeDefined();
  });
});
