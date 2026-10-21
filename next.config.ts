import type { NextConfig } from 'next';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  webpack(config) {
    // Markdown is parsed in a Worker. Next's client condition also applies to
    // worker children, so select the package's DOM-free implementation explicitly.
    config.resolve.alias['decode-named-character-reference$'] = require.resolve('decode-named-character-reference');
    return config;
  },
};
export default nextConfig;
