// Regole italiane delle scadenze (SPEC §7): revisione, bollo, gas, patente, passaggio di proprieta'.
// Le regole dell'assicurazione e dei pneumatici stanno in '@/domain/insurance' e '@/domain/tyres'.
// Dominio puro: nessun orologio, nessun import di pacchetti.
export * from './types';
export * from './sources';
export * from './calendar';
export * from './inspection';
export * from './roadTax';
export * from './gas';
export * from './licence';
export * from './transfer';
export * from './registry';
