// Tema chiaro/scuro automatico: segue il sistema (app.json: userInterfaceStyle "automatic").
import { useColorScheme } from 'react-native';
import { palettes, type ColorScheme, type Palette } from './tokens';

export function useColorSchemeName(): ColorScheme {
  return useColorScheme() === 'dark' ? 'dark' : 'light';
}

export function useTheme(): Palette {
  return palettes[useColorSchemeName()];
}
