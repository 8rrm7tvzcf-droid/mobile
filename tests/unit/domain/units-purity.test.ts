import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Purezza del dominio di base (SPEC §8.6): units, odometer, fuel, costs, fluids importano solo dominio e non toccano
// orologio, casualita', localizzazione del runtime o console. Controllo sul sorgente, senza eseguirlo.
const ROOT = fileURLToPath(new URL('../../../src/domain/', import.meta.url));
const DIRS = ['units', 'odometer', 'fuel', 'costs', 'fluids'];

function sources(): { file: string; code: string }[] {
  const out: { file: string; code: string }[] = [];
  for (const d of DIRS) {
    for (const name of readdirSync(join(ROOT, d))) {
      if (!name.endsWith('.ts')) continue;
      const raw = readFileSync(join(ROOT, d, name), 'utf8');
      // via commenti (a blocco e di riga): si controlla il codice, non le spiegazioni
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      out.push({ file: `${d}/${name}`, code });
    }
  }
  return out;
}

describe('units/odometer/fuel/costs/fluids: purezza del dominio', () => {
  const files = sources();

  it('ci sono i file attesi (un index per cartella)', () => {
    for (const d of DIRS) expect(files.some((f) => f.file === `${d}/index.ts`)).toBe(true);
    expect(files.length).toBeGreaterThanOrEqual(20);
  });

  it('nessun orologio, casualita, localizzazione del runtime, console o ambiente', () => {
    const forbidden = /\bDate\.now\b|\bnew Date\b|\bDate\(|\bMath\.random\b|\bIntl\b|\.toLocale\w*|\bconsole\.|\bprocess\.|\bperformance\.now\b|\brequire\(/;
    for (const f of files) expect({ file: f.file, hit: forbidden.exec(f.code)?.[0] ?? null }).toEqual({ file: f.file, hit: null });
  });

  it('importano solo il dominio: alias @/domain/..., percorsi relativi e nessun pacchetto', () => {
    const importRe = /(?:import|export)\s[^;]*?from\s+'([^']+)'/g;
    let found = 0;
    for (const f of files) {
      for (const m of f.code.matchAll(importRe)) {
        const spec = m[1]!;
        const ok = spec.startsWith('./') || spec.startsWith('@/domain/');
        expect({ file: f.file, spec, ok }).toEqual({ file: f.file, spec, ok: true });
        found += 1;
      }
    }
    expect(found).toBeGreaterThan(30); // il controllo non e vuoto
  });

  it('non risalgono agli strati superiori (usecases, data, platform, obd, ui)', () => {
    const upward = /from\s+'@\/(?!domain\/)[^']*'/;
    for (const f of files) expect({ file: f.file, upward: upward.test(f.code) }).toEqual({ file: f.file, upward: false });
  });
});
