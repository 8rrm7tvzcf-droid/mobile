// Finestra "I km non tornano" con le tre scelte di SPEC 6.3.6 punto 5: Correggi · Salva senza aggiornare i km ·
// È un errore della lettura precedente. Usata da Aggiorna km, rifornimenti (e dagli altri moduli che scrivono km).
import type { ReactNode } from 'react';
import type { DistanceUnit } from '@/domain/units';
import type { OdometerConflictError } from '@/usecases/odometer';
import { it } from '../i18n/it';
import { rangeHint } from '../logic/odometer';
import { Button } from './Button';
import { Sheet } from './Sheet';
import { Text } from './Text';

export interface OdometerConflictSheetProps {
  conflict: OdometerConflictError | null;
  unit: DistanceUnit;
  busy?: boolean;
  /** Mostra «Salva senza aggiornare i km» (rifornimenti, interventi, controlli: il dato si salva anche senza i km). */
  onSkipKm?: () => void;
  onFix: () => void;
  onIgnorePrevious: () => void;
}

export function OdometerConflictSheet({ conflict, unit, busy = false, onSkipKm, onFix, onIgnorePrevious }: OdometerConflictSheetProps): ReactNode {
  return (
    <Sheet
      visible={conflict !== null}
      title={it.km.conflictTitle}
      message={conflict ? `${it.errors.kmNotMonotonic} ${rangeHint(conflict.allowedRange, unit)}` : undefined}
      onClose={onFix}
    >
      <Button label={it.km.conflictFix} onPress={onFix} />
      {onSkipKm ? (
        <>
          <Text variant="caption" color="muted">
            {it.km.conflictSkipKmHint}
          </Text>
          <Button label={it.km.conflictSkipKm} variant="secondary" loading={busy} onPress={onSkipKm} />
        </>
      ) : null}
      <Text variant="caption" color="muted">
        {it.km.conflictPrevWrongHint}
      </Text>
      <Button label={it.km.conflictPrevWrong} variant="secondary" loading={busy} onPress={onIgnorePrevious} />
    </Sheet>
  );
}
