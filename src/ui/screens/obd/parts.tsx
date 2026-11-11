// Pezzi comuni delle schermate OBD: semaforo con icona e testo, provenienza del dato, elenchi, avanzamento.
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { Provenance } from '@/bootstrap';
import { Button, Card, Icon, Text, type IconName } from '../../components';
import { it } from '../../i18n/it';
import { radius, space, type ToneKey } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';

/** Semaforo: SEMPRE icona + testo, mai solo colore (NFR-07). */
export function ToneBadge({ tone, icon, label }: { tone: ToneKey; icon: IconName; label: string }): ReactNode {
  const p = useTheme();
  const colors = p.tone[tone];
  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]} accessible accessibilityLabel={label}>
      <Icon name={icon} color={colors.fg} size={16} />
      <Text variant="label" color={tone} style={styles.flexShrink}>
        {label}
      </Text>
    </View>
  );
}

const PROVENANCE_ICON: Record<Provenance, IconName> = { read: 'plug', estimated: 'info', entered: 'edit' };

/** Etichetta di provenienza sempre visibile e letta dai lettori di schermo (SPEC 5.2). */
export function ProvenanceTag({ source, when }: { source: Provenance; when?: string }): ReactNode {
  const p = useTheme();
  const label = it.obd.provenance[source];
  const full = when ? `${label} · ${when}` : label;
  return (
    <View style={styles.tag} accessible accessibilityLabel={full}>
      <Icon name={PROVENANCE_ICON[source]} color={p.textMuted} size={14} />
      <Text variant="caption" color="muted" style={styles.flexShrink}>
        {full}
      </Text>
    </View>
  );
}

/** Elenco puntato con icona (spunta per "si legge", croce per "non si legge"). */
export function IconList({ items, icon, tone }: { items: readonly string[]; icon: IconName; tone: ToneKey }): ReactNode {
  const p = useTheme();
  return (
    <View style={styles.list}>
      {items.map((text) => (
        <View key={text} style={styles.listRow}>
          <Icon name={icon} color={p.tone[tone].fg} size={18} />
          <Text variant="body" style={styles.flexShrink}>
            {text}
          </Text>
        </View>
      ))}
    </View>
  );
}

export interface ProgressCardProps {
  title: string;
  text?: string;
  hint?: string;
  cancelLabel?: string;
  onCancel?: () => void;
  testID?: string;
}

/** Avanzamento di collegamento o lettura: annunciato ai lettori di schermo e, se serve, annullabile. */
export function ProgressCard({ title, text, hint, cancelLabel, onCancel, testID }: ProgressCardProps): ReactNode {
  const p = useTheme();
  return (
    <Card testID={testID}>
      <View style={styles.progressHead} accessibilityLiveRegion="polite">
        <ActivityIndicator color={p.primary} />
        <Text variant="heading" style={styles.flexShrink}>
          {title}
        </Text>
      </View>
      {text ? (
        <Text variant="body" accessibilityLiveRegion="polite">
          {text}
        </Text>
      ) : null}
      {hint ? (
        <Text variant="caption" color="muted">
          {hint}
        </Text>
      ) : null}
      {onCancel && cancelLabel ? <Button label={cancelLabel} variant="ghost" onPress={onCancel} /> : null}
    </Card>
  );
}

/** Riga etichetta + valore, con la provenienza sotto. */
export function ValueLine({
  label,
  value,
  source,
  when,
  a11y,
}: {
  label: string;
  value: string;
  source: Provenance;
  when?: string;
  a11y: string;
}): ReactNode {
  return (
    <View style={styles.valueLine} accessible accessibilityLabel={a11y}>
      <Text variant="label" color="muted">
        {label}
      </Text>
      <Text variant="title">{value}</Text>
      <ProvenanceTag source={source} when={when} />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.xs + 2,
    borderRadius: radius.pill,
    maxWidth: '100%',
  },
  tag: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  flexShrink: { flexShrink: 1 },
  list: { gap: space.sm },
  listRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  progressHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  valueLine: { gap: 2, paddingVertical: space.xs },
});
