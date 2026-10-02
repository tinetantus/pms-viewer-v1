import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  { settings: { next: { rootDir: 'apps/web/' } } },
  // Authenticated source images must bypass the public image optimization cache.
  { files: ['apps/web/src/components/**/*.tsx'], rules: { '@next/next/no-img-element': 'off' } },
  globalIgnores([
    '**/.next/**',
    '**/dist/**',
    '**/next-env.d.ts',
    '.venv/**',
    'local-data/**',
    'artifacts/**',
    'apps/web/public/pdfjs/**',
    'test-results/**',
  ]),
]);
