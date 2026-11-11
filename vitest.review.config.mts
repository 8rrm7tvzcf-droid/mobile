// Configurazione SEPARATA per le prove di riproduzione scritte durante la revisione del codice:
// ogni file tests/review/**/*.repro.ts deve FALLIRE finche' il bug non e' corretto (asserisce il comportamento giusto).
// Dopo la correzione la prova si rinomina in *.test.ts e passa nella suite normale ('npm test').
// Uso: npx vitest run -c vitest.review.config.mts tests/review/<area>/<file>.repro.ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/review/**/*.repro.ts'],
  },
});
