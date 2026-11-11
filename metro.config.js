// Configurazione di Metro (SPEC 8.8, livello 2: anteprima web).
// Parte dalla configurazione di Expo e aggiunge 'wasm' agli asset: l'anteprima web apre il database con sql.js
// (SQLite in WebAssembly) e Metro deve servire `sql-wasm-browser.wasm` come file, non provare a trasformarlo in codice.
// L'URL del file lo ricava src/bootstrap/root.web.ts con expo-asset.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

module.exports = config;
