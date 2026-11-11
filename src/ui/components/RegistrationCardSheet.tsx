// Foglio "Compila dal libretto": l'utente incolla il testo copiato dalla foto del libretto (riconoscimento del testo del
// telefono), l'app lo legge sul telefono, mostra cosa ha riconosciuto e riempie solo i campi ancora vuoti.
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { it } from '../i18n/it';
import { applyCardToForm, cardRows, readRegistrationCard, type ApplyResult, type ReadCard } from '../logic/registrationCard';
import type { VehicleFormState } from '../logic/vehicleForm';
import { space } from '../theme/tokens';
import { Banner } from './Banner';
import { Button } from './Button';
import { Card } from './Card';
import { Sheet } from './Sheet';
import { Text } from './Text';
import { TextField } from './TextField';

export interface RegistrationCardSheetProps {
  visible: boolean;
  /** Il modulo com'e' adesso: serve a non sovrascrivere cio' che l'utente ha gia' scritto. */
  form: VehicleFormState;
  onClose: () => void;
  onApply: (result: ApplyResult) => void;
}

export function RegistrationCardSheet({ visible, form, onClose, onApply }: RegistrationCardSheetProps): ReactNode {
  const [text, setText] = useState('');
  const [card, setCard] = useState<ReadCard | null>(null);
  const rows = card ? cardRows(card) : [];

  const close = (): void => {
    setText('');
    setCard(null);
    onClose();
  };

  const apply = (): void => {
    if (!card) return;
    onApply(applyCardToForm(form, card));
    close();
  };

  return (
    <Sheet visible={visible} title={it.vehicleForm.card.sheetTitle} message={it.vehicleForm.card.sheetIntro} onClose={close}>
      <TextField
        label={it.vehicleForm.card.pasteLabel}
        multiline
        value={text}
        onChangeText={(t) => {
          setText(t);
          setCard(null);
        }}
        maxLength={6000}
        testID="card-text"
      />
      <Button label={it.vehicleForm.card.read} variant={card ? 'secondary' : 'primary'} disabled={text.trim() === ''} onPress={() => setCard(readRegistrationCard(text))} testID="card-read" />

      {card && rows.length === 0 ? <Banner tone="info" title={it.vehicleForm.card.nothingFound} /> : null}

      {card && rows.length > 0 ? (
        <View style={styles.result}>
          <Text variant="heading">{it.vehicleForm.card.foundTitle}</Text>
          <Card>
            {rows.map((r) => (
              <View key={r.key} style={styles.row} testID={`card-row-${r.key}`}>
                <Text variant="label" color="muted">
                  {r.label}
                </Text>
                <Text variant="bodyStrong">{r.value}</Text>
              </View>
            ))}
          </Card>
          <Text variant="caption" color="muted">
            {it.vehicleForm.card.checkHint}
          </Text>
          <Button label={it.vehicleForm.card.use} icon="check" onPress={apply} testID="card-use" />
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  result: { gap: space.sm },
  row: { gap: space.xs, paddingVertical: space.xs },
});
