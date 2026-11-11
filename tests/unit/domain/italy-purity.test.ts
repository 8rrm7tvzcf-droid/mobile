import { describe, expect, it } from 'vitest';

// SPEC §8.6: il dominio e TypeScript PURO. Nessun pacchetto npm, nessun orologio, nessun caso, nessun Intl.
// ImportMeta.glob e di Vite (vitest): i tipi 'vite/client' non sono nel tsconfig del progetto.
// @ts-ignore
const sources = import.meta.glob(['/src/domain/italy/*.ts', '/src/domain/insurance/*.ts', '/src/domain/tyres/*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Toglie i commenti: i divieti valgono per il codice, non per le spiegazioni. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('purezza del dominio (italy, insurance, tyres)', () => {
  const entries = Object.entries(sources);

  it('trova i file da controllare', () => {
    expect(entries.length).toBeGreaterThanOrEqual(15);
  });

  it('nessun orologio, nessun caso, nessun Intl, nessun globale di piattaforma', () => {
    const forbidden = /\b(Date\.now|new Date|Date\.UTC|Math\.random|Intl\.|performance\.now|process\.|require\(|globalThis|window\.|setTimeout|setInterval|fetch\()/;
    for (const [path, src] of entries) {
      const code = stripComments(src);
      expect(code, path).not.toMatch(forbidden);
      expect(code, path).not.toMatch(/\bDate\(/);
    }
  });

  it('importa solo codice del progetto (@/domain/...) o file relativi: nessun pacchetto npm', () => {
    for (const [path, src] of entries) {
      const specifiers = [...stripComments(src).matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');
      for (const spec of specifiers) {
        expect(spec.startsWith('./') || spec.startsWith('@/domain/'), `${path}: ${spec}`).toBe(true);
      }
    }
  });

  it('non risale agli strati superiori (usecases, data, platform, obd, components)', () => {
    for (const [path, src] of entries) {
      expect(stripComments(src), path).not.toMatch(/@\/(usecases|data|platform|obd|components|app|hooks|constants)\b/);
    }
  });

  it('insurance e tyres non dipendono dall indice di italy (nessun ciclo): solo dai file foglia', () => {
    for (const [path, src] of entries) {
      if (path.includes('/domain/italy/')) continue;
      const specifiers = [...stripComments(src).matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');
      expect(specifiers, path).not.toContain('@/domain/italy');
    }
  });
});
