import { cp, mkdir } from 'node:fs/promises';
const destination = 'apps/web/public/pdfjs';
await mkdir(destination, { recursive: true });
for (const name of ['cmaps', 'standard_fonts', 'wasm'])
  await cp(`node_modules/pdfjs-dist/${name}`, `${destination}/${name}`, { recursive: true });
await cp('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', `${destination}/pdf.worker.min.mjs`);
