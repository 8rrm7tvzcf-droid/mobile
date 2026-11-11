# Licenze di terze parti

Questo progetto non e' open source (vedi `LICENSE`), ma contiene materiale di terzi che
resta sotto la licenza originale.

## Template di Expo (`create-expo-app`) — licenza MIT

Alcuni file nascono dal template ufficiale di Expo e si trovano ancora nel repository:
`scripts/reset-project.js`, le immagini in `assets/images/` (icone, logo di avvio e
immagini di esempio), la configurazione di base di TypeScript e di VS Code, e `AGENTS.md`.
Per questi file vale la licenza MIT seguente, di cui qui si conserva l'avviso di copyright
come richiesto:

```
The MIT License (MIT)

Copyright (c) 2015-present 650 Industries, Inc. (aka Expo)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Dipendenze

Le librerie installate con `npm install` (Expo, React Native, React e le altre elencate in
`package.json` e `package-lock.json`) non sono incluse nel repository e restano sotto le
rispettive licenze. L'elenco completo delle licenze va generato e rivisto prima di ogni
rilascio dell'app (vedi la specifica, requisito NFR-11: nessuna dipendenza GPL, AGPL o
non commerciale incorporata).
