import type { NextConfig } from 'next';
import path from 'node:path';

const config: NextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: path.resolve(import.meta.dirname, '../..'),
  turbopack: { root: path.resolve(import.meta.dirname, '../..') },
};
export default config;
