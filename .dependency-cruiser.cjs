// Regole di dipendenza tra gli strati (SPEC 8.6). Si esegue con: npm run depcruise
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Niente cicli di dipendenza.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-imports-only-domain',
      severity: 'error',
      comment: 'Il dominio e puro: importa solo se stesso (niente pacchetti npm, React, Expo, SQLite, moduli di Node).',
      from: { path: '^src/domain/' },
      to: { pathNot: '^src/domain/' },
    },
    {
      name: 'usecases-import-only-domain',
      severity: 'error',
      comment: 'I casi d uso conoscono solo il dominio (e le porte che il dominio dichiara).',
      from: { path: '^src/usecases/' },
      to: { pathNot: '^src/(domain|usecases)/' },
    },
    {
      name: 'adapters-do-not-climb',
      severity: 'error',
      comment: 'data, platform e obd implementano le porte: non risalgono verso casi d uso, UI o bootstrap.',
      from: { path: '^src/(data|platform|obd)/' },
      to: { path: '^src/(usecases|ui|app|bootstrap)/' },
    },
    {
      name: 'adapters-do-not-cross',
      severity: 'error',
      comment: 'data, platform e obd non si importano tra loro.',
      from: { path: '^src/data/' },
      to: { path: '^src/(platform|obd)/' },
    },
    {
      name: 'ui-does-not-touch-infrastructure',
      severity: 'error',
      comment: 'La UI passa dai casi d uso: non importa data, platform, obd.',
      from: { path: '^src/(ui|app)/' },
      to: { path: '^src/(data|platform|obd)/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types'],
    },
  },
};
