# Códecs de terceros (carga bajo demanda)

Builds **asm.js / wasm2js** (JavaScript puro): no usan WebAssembly real ni `eval`, así que funcionan con la CSP de
producción (`script-src 'self'`, sin `'wasm-unsafe-eval'`). El visor los carga con un `<script>` del mismo origen
solo cuando un fichero los necesita (`src/app/clases/Decoders/codec-loader.ts`). Se copian tal cual, sin modificar.

| Fichero | Paquete npm (versión) | Licencia del *wrapper* | Librería incluida | Licencia de la librería | SHA-256 |
|---|---|---|---|---|---|
| `openjpegjs_decode.js` | `@cornerstonejs/codec-openjpeg` 1.3.6 (`dist/openjpegjs_decode.js`) | MIT | OpenJPEG 2.5.x (JPEG 2000 Part 1/2 y HTJ2K, solo decodificador) | BSD 2-Clause | `d08864a5b6b023dc5c0cc32badbf9938ac691b6cbb68c2d5a9f68c01e0ad10fc` |
| `libjpegturbojs_decode.js` | `@cornerstonejs/codec-libjpeg-turbo-8bit` 1.2.8 (`dist/libjpegturbojs_decode.js`) | ISC | libjpeg-turbo (JPEG 8 bits: *baseline*, extendido, progresivo y aritmético; solo decodificador) | IJG License + BSD 3-Clause (Modified) + zlib | `eab3a9b2e1e802679006715f85a7b0ae74c369e392cb12579d2aab6c13fc491f` |

Proyectos de origen:
- Cornerstone codecs: https://github.com/cornerstonejs/codecs
- OpenJPEG: https://github.com/uclouvain/openjpeg
- libjpeg-turbo: https://github.com/libjpeg-turbo/libjpeg-turbo

Este software se basa en parte en el trabajo del Independent JPEG Group (requisito de la licencia IJG de libjpeg-turbo).

Para actualizarlos:
1. `npm pack` de la versión nueva.
2. Copiar los `dist/*js_decode.js`.
3. Actualizar esta tabla (versión y SHA-256).
4. Pasar la batería `tools/dicom-test` y la prueba en navegador con la CSP de producción.
