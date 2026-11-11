// Impostazioni dell'app (F-11): lettura tipizzata con i predefiniti dell'Appendice C, scrittura validata.
export * from './defaults';
export { settingError, isValidSetting } from './validate';
export {
  readSetting,
  getSetting,
  getSettings,
  getDeviceId,
  setSetting,
  setSettings,
  resetSetting,
  type SettingsPatch,
} from './settings';
