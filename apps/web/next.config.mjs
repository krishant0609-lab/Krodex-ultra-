import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.resolve.alias['@'] = path.resolve(__dirname, 'src');
    return config;
  },
  // We do not transpile the shared package because it builds to dist/.
  // Next.js consumes it as a normal workspace dependency.
  experimental: {
    typedRoutes: false,
  },
  // No image domains configured yet. UI work is Phase 7+ per the
  // Project Implementation Plan.
};

export default nextConfig;
