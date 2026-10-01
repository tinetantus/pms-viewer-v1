import type { NextConfig } from 'next';
import path from 'node:path';

const config: NextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: path.resolve(__dirname, '../..'),
  turbopack: { root: path.resolve(__dirname, '../..') },
};
export default config;
