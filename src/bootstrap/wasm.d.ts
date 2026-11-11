// I file .wasm importati da Metro (config in metro.config.js: 'wasm' fra gli asset) diventano un id di asset:
// per l'URL vero si passa da expo-asset (vedi root.web.ts).
declare module '*.wasm' {
  const assetId: number;
  export default assetId;
}
