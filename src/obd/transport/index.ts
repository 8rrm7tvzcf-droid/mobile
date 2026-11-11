// Trasporti OBD: simulato (web, Expo Go, demo), mock con trascrizioni, BLE (non provato su dispositivo).
// Questo barrel NON importa moduli nativi: il BLE reale si carica solo dentro createTransport('ble').
export * from './types';
export * from './chunking';
export * from './MockTransport';
export * from './SimulatedTransport';
export * from './BleTransport';
export * from './bleSelect';
export * from './createTransport';
export * from './simulator/scenarios';
export { Elm327Emulator } from './simulator/elm327Emulator';
export type { EmulatorOptions, HandleResult, ReplyPart } from './simulator/elm327Emulator';
export { carStateAt } from './simulator/virtualCar';
export type { CarState } from './simulator/virtualCar';
