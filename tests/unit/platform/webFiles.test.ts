// Adattatori WEB dei file (anteprima su PC) con un DOM finto: selettore <input type=file> e download via Blob + <a download>.
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: async (_algo: string, data: Uint8Array) => {
    const b = createHash('sha256').update(data).digest();
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  },
}));

import type { PickedFile } from '@/domain/ports';
import { createNullFileBackend } from '@/platform/files/indexedDbFileBackend';
import { createMemoryFileStore } from '@/platform/files/memoryFileStore';
import { createWebFilePicker, type DocumentLike, type FileInputLike, type WebFileLike } from '@/platform/files/webFilePicker';
import { createWebFileServices } from '@/platform/files/webFileServices';
import { createWebFileSharer, type AnchorLike, type DownloadDocumentLike, type UrlApiLike } from '@/platform/files/webFileSharer';

const sha256Hex = async (b: Uint8Array): Promise<string> => createHash('sha256').update(b).digest('hex');

function webFile(name: string, content: number[], type = ''): WebFileLike {
  const data = Uint8Array.from(content);
  return { name, type, size: data.byteLength, arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer };
}

class FakeInput implements FileInputLike {
  type = '';
  accept = '';
  multiple = true;
  files: ArrayLike<WebFileLike> | null = null;
  style = { display: '' };
  attributes: Record<string, string> = {};
  listeners: Partial<Record<'change' | 'cancel', () => void>> = {};
  removed = false;
  onClick: (input: FakeInput) => void = () => undefined;
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  addEventListener(type: 'change' | 'cancel', listener: () => void): void {
    this.listeners[type] = listener;
  }
  click(): void {
    this.onClick(this);
  }
  remove(): void {
    this.removed = true;
  }
}

function fakeDocument(onClick: (input: FakeInput) => void) {
  const created: FakeInput[] = [];
  const appended: unknown[] = [];
  const doc: DocumentLike = {
    createElement: () => {
      const input = new FakeInput();
      input.onClick = onClick;
      created.push(input);
      return input;
    },
    body: { appendChild: (n) => appended.push(n) },
  };
  return { doc, created, appended };
}

describe('FilePicker web', () => {
  it('pickDocument: copia il file nel FileStore sotto temp/picked e restituisce l\'URI virtuale leggibile', async () => {
    const files = createMemoryFileStore({ sha256Hex });
    const { doc, created, appended } = fakeDocument((input) => {
      input.files = [webFile('Fattura officina.pdf', [1, 2, 3, 4], 'application/pdf')];
      input.listeners.change?.();
    });
    const picked = await createWebFilePicker({ files, tempDir: 'temp', document: doc }).pickDocument({ types: ['application/pdf', 'image/*'] });
    const input = created[0] as FakeInput;
    expect(input.type).toBe('file');
    expect(input.accept).toBe('application/pdf,image/*');
    expect(input.multiple).toBe(false);
    expect(input.attributes['capture']).toBeUndefined();
    expect(appended).toEqual([input]); // attaccato al documento (Safari)
    expect(input.removed).toBe(true);
    expect(picked).toMatchObject<Partial<PickedFile>>({ name: 'Fattura officina.pdf', mimeType: 'application/pdf', size: 4 });
    expect((picked as PickedFile).uri).toMatch(/^temp\/picked\/.+Fattura officina\.pdf$/);
    expect(Array.from(await files.read((picked as PickedFile).uri))).toEqual([1, 2, 3, 4]);
  });

  it('il nome sul disco virtuale non contiene caratteri pericolosi e due scelte dello stesso file non si sovrascrivono', async () => {
    const files = createMemoryFileStore({ sha256Hex });
    const { doc } = fakeDocument((input) => {
      input.files = [webFile('a/b:c*d.jpg', [9])];
      input.listeners.change?.();
    });
    const picker = createWebFilePicker({ files, tempDir: 'temp', document: doc });
    const one = (await picker.pickImage({ camera: false })) as PickedFile;
    const two = (await picker.pickImage({ camera: false })) as PickedFile;
    expect(one.uri).not.toBe(two.uri);
    expect(one.uri).not.toMatch(/[:*]/);
    expect(one.uri.split('/')).toHaveLength(3); // temp / picked / <nome>
    expect(one.name).toBe('a/b:c*d.jpg'); // il nome mostrato e' quello originale
    expect(one.mimeType).toBe('image/jpeg'); // dedotto dall'estensione perche' il browser non l'ha dato
  });

  it('pickImage: solo immagini; con la fotocamera chiede capture=environment', async () => {
    const files = createMemoryFileStore({ sha256Hex });
    const { doc, created } = fakeDocument((input) => {
      input.files = [webFile('foto.png', [1], 'image/png')];
      input.listeners.change?.();
    });
    const picker = createWebFilePicker({ files, tempDir: 'temp', document: doc });
    await picker.pickImage({ camera: false });
    await picker.pickImage({ camera: true });
    expect(created.map((i) => i.accept)).toEqual(['image/*', 'image/*']);
    expect(created[0]?.attributes['capture']).toBeUndefined();
    expect(created[1]?.attributes['capture']).toBe('environment');
  });

  it("annullato (evento 'cancel') o nessun file -> null, e nulla si scrive", async () => {
    const files = createMemoryFileStore({ sha256Hex });
    const cancel = fakeDocument((input) => input.listeners.cancel?.());
    expect(await createWebFilePicker({ files, tempDir: 'temp', document: cancel.doc }).pickDocument({ types: [] })).toBeNull();
    expect(cancel.created[0]?.removed).toBe(true);
    const empty = fakeDocument((input) => {
      input.files = [];
      input.listeners.change?.();
    });
    expect(await createWebFilePicker({ files, tempDir: 'temp', document: empty.doc }).pickImage({ camera: false })).toBeNull();
    expect(await files.list('')).toEqual([]);
  });

  it("'change' e 'cancel' insieme: vale il primo evento", async () => {
    const files = createMemoryFileStore({ sha256Hex });
    const { doc } = fakeDocument((input) => {
      input.files = [webFile('x.pdf', [1])];
      input.listeners.change?.();
      input.listeners.cancel?.();
    });
    expect(await createWebFilePicker({ files, tempDir: 'temp', document: doc }).pickDocument({ types: [] })).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('FileSharer web (download)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const anchors: Array<AnchorLike & { clicked: boolean; removed: boolean }> = [];
    const doc: DownloadDocumentLike = {
      createElement: () => {
        const a = { href: '', download: '', rel: '', style: { display: '' }, clicked: false, removed: false, click() { a.clicked = true; }, remove() { a.removed = true; } };
        anchors.push(a);
        return a;
      },
      body: { appendChild: () => undefined },
    };
    const blobs: Blob[] = [];
    const url: UrlApiLike = {
      createObjectURL: vi.fn((b: Blob) => {
        blobs.push(b);
        return 'blob:mygarage-1';
      }),
      revokeObjectURL: vi.fn(),
    };
    const files = createMemoryFileStore({ sha256Hex });
    return { anchors, blobs, url, files, sharer: createWebFileSharer({ files, document: doc, url }) };
  }

  it('scarica il file con il suo nome e il tipo MIME, poi libera l\'URL temporaneo', async () => {
    const { anchors, blobs, url, files, sharer } = setup();
    await files.write('temp/MyGarage-2026-10-13.zip', Uint8Array.from([80, 75, 3, 4]));
    await sharer.shareFile('temp/MyGarage-2026-10-13.zip', 'application/zip', 'Backup di MyGarage');
    const a = anchors[0];
    expect(a?.href).toBe('blob:mygarage-1');
    expect(a?.download).toBe('MyGarage-2026-10-13.zip');
    expect(a?.clicked).toBe(true);
    expect(a?.removed).toBe(true);
    expect(blobs[0]?.type).toBe('application/zip');
    expect(blobs[0]?.size).toBe(4);
    expect(url.revokeObjectURL).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(url.revokeObjectURL).toHaveBeenCalledWith('blob:mygarage-1');
  });

  it('un file che non esiste rifiuta la promessa e non crea link', async () => {
    const { anchors, sharer } = setup();
    await expect(sharer.shareFile('temp/manca.zip', 'application/zip', 'x')).rejects.toThrow(/non trovato/);
    expect(anchors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('createWebFileServices', () => {
  it('servizi collegati tra loro, con cartelle virtuali e persistenza sostituibile', async () => {
    const fs = await createWebFileServices({ backend: createNullFileBackend() });
    expect(fs.dirs).toEqual({ attachments: 'attachments', backups: 'backups', temp: 'temp' });
    const stored = `${fs.dirs.attachments}/01ABC.pdf`;
    await fs.files.write(stored, new TextEncoder().encode('abc'));
    expect(await fs.files.sha256(stored)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await fs.hash.sha256Hex(await fs.files.read(stored))).toBe(await fs.files.sha256(stored));
    const round = fs.zip.unzip(fs.zip.zip([{ name: stored, bytes: await fs.files.read(stored) }]));
    expect(round.map((e) => e.name)).toEqual([stored]);
    expect(typeof fs.picker.pickDocument).toBe('function');
    expect(typeof fs.sharer.shareFile).toBe('function');
  });

  it('riapre i file salvati dal backend', async () => {
    const saved: Array<[string, Uint8Array]> = [['attachments/OLD.pdf', Uint8Array.from([1, 2])]];
    const backend = { ...createNullFileBackend(), loadAll: async () => saved };
    const fs = await createWebFileServices({ backend });
    expect(Array.from(await fs.files.read('attachments/OLD.pdf'))).toEqual([1, 2]);
  });
});
