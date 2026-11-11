// Foglio delle azioni rapide ("+", S-15): sceglie l'azione e, se serve, l'auto. Usato da "Oggi" e dal Registro.
// Azioni presenti: Rifornimento, Spesa, Intervento, Controllo livello, Polizza, Aggiorna km, Imposta scadenze, Aggiungi un'auto.
import { useRouter, type Href } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { it } from '../i18n/it';
import { routes } from '../navigation/routes';
import { Button } from './Button';
import { ListRow } from './ListRow';
import { Sheet } from './Sheet';
import type { IconName } from './Icon';

export type QuickAction = 'fuel' | 'expense' | 'service' | 'fluid' | 'policy' | 'km' | 'setup';

export interface QuickVehicle {
  id: string;
  label: string;
  plate: string | null;
}

export interface QuickAddSheetProps {
  visible: boolean;
  onClose: () => void;
  vehicles: readonly QuickVehicle[];
  /** L'auto gia' scelta (filtro attivo): se c'e', non si chiede per quale auto. */
  vehicleId: string | null;
  /** Se indicata, il foglio si apre gia' sulla scelta dell'auto per questa azione. */
  startWith?: QuickAction | null;
}

const ACTIONS: { action: QuickAction; label: string; icon: IconName; href: (id: string) => Href }[] = [
  { action: 'fuel', label: it.today.quickFuel, icon: 'fuel', href: routes.fuelNew },
  { action: 'expense', label: it.today.quickExpense, icon: 'receipt', href: routes.expenseNew },
  { action: 'service', label: it.today.quickService, icon: 'wrench', href: (id) => routes.serviceNew(id) },
  { action: 'fluid', label: it.today.quickFluid, icon: 'droplet', href: (id) => routes.fluidNew(id) },
  { action: 'policy', label: it.today.quickPolicy, icon: 'shield', href: routes.policyNew },
  { action: 'km', label: it.today.quickUpdateKm, icon: 'gauge', href: routes.vehicleKm },
  { action: 'setup', label: it.today.quickSetup, icon: 'calendar', href: (id) => routes.setup(id) },
];

export function QuickAddSheet({ visible, onClose, vehicles, vehicleId, startWith = null }: QuickAddSheetProps): ReactNode {
  const router = useRouter();
  const [picking, setPicking] = useState<QuickAction | null>(null);

  useEffect(() => {
    setPicking(visible ? startWith : null);
  }, [visible, startWith]);

  const go = (action: QuickAction, id: string): void => {
    onClose();
    const entry = ACTIONS.find((a) => a.action === action);
    if (entry) router.push(entry.href(id));
  };

  const run = (action: QuickAction): void => {
    const only = vehicleId ?? (vehicles.length === 1 ? (vehicles[0]?.id ?? null) : null);
    if (only) go(action, only);
    else setPicking(action);
  };

  return (
    <Sheet visible={visible} title={picking ? it.today.quickPickCar : it.today.quickTitle} onClose={onClose}>
      {picking === null
        ? ACTIONS.map((a) => <ListRow key={a.action} title={a.label} icon={a.icon} onPress={() => run(a.action)} />)
        : vehicles.map((v) => <ListRow key={v.id} title={v.label} subtitle={v.plate} icon="car" onPress={() => go(picking, v.id)} />)}
      {picking === null ? (
        <ListRow
          title={it.today.quickAddCar}
          icon="car"
          onPress={() => {
            onClose();
            router.push(routes.newVehicle);
          }}
        />
      ) : null}
      <Button label={it.common.cancel} variant="ghost" onPress={onClose} />
    </Sheet>
  );
}
