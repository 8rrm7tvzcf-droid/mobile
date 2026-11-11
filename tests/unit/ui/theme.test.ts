import { describe, expect, it } from 'vitest';
import { contrastRatio, dark, light, luminance, MIN_TOUCH, palettes, type Palette, type ToneKey } from '@/ui/theme/tokens';

const TONES: ToneKey[] = ['danger', 'warning', 'ok', 'unknown', 'info'];

describe('contrasto WCAG', () => {
  it('calcola i riferimenti noti', () => {
    expect(luminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(luminance('#000000')).toBeCloseTo(0, 5);
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 3);
    expect(() => luminance('rosso')).toThrow();
  });

  for (const [name, palette] of Object.entries(palettes) as [string, Palette][]) {
    describe(`tema ${name}`, () => {
      it('il testo ha contrasto >= 4,5:1 su sfondo e superfici', () => {
        for (const bg of [palette.background, palette.surface, palette.surfaceAlt]) {
          expect(contrastRatio(palette.text, bg)).toBeGreaterThanOrEqual(4.5);
          expect(contrastRatio(palette.textMuted, bg)).toBeGreaterThanOrEqual(4.5);
        }
      });

      it('il colore primario e il testo sul primario sono leggibili', () => {
        expect(contrastRatio(palette.primary, palette.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(palette.primary, palette.background)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(palette.onPrimary, palette.primary)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(palette.onPrimarySoft, palette.primarySoft)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(palette.onDanger, palette.danger)).toBeGreaterThanOrEqual(4.5);
      });

      it('ogni tono semantico ha testo leggibile sul proprio sfondo', () => {
        for (const tone of TONES) {
          const { fg, bg } = palette.tone[tone];
          expect(contrastRatio(fg, bg), `${name}/${tone}`).toBeGreaterThanOrEqual(4.5);
        }
      });

      it('il bordo dei campi ha contrasto >= 3:1 sulla superficie', () => {
        expect(contrastRatio(palette.borderStrong, palette.surface)).toBeGreaterThanOrEqual(3);
      });

      it('il testo dei toni resta leggibile anche sulla superficie neutra', () => {
        for (const tone of TONES) expect(contrastRatio(palette.tone[tone].fg, palette.surface)).toBeGreaterThanOrEqual(4.5);
      });
    });
  }

  it('i due temi hanno gli stessi token', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
    expect(Object.keys(dark.tone).sort()).toEqual(Object.keys(light.tone).sort());
  });

  it('l\'area di tocco minima e\' 48 dp', () => {
    expect(MIN_TOUCH).toBe(48);
  });
});
