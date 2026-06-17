import type { NextConfig } from 'next';
import path from 'path';
const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs'],
  },
  experimental: {
    extensionAlias: {
      '.js': ['.tsx', '.ts', '.jsx', '.js'],
    },
  },
  webpack(config) {
    // Allow .js imports to resolve .tsx/.ts files (ESM convention in TS source)
    config.resolve = {
      ...config.resolve,
      extensionAlias: {
        '.js': ['.tsx', '.ts', '.jsx', '.js'],
      },
    };
    return config;
  },
};
export default nextConfig;
