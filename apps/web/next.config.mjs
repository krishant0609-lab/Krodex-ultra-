/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // We do not transpile the shared package because it builds to dist/.
  // Next.js consumes it as a normal workspace dependency.
  experimental: {
    typedRoutes: false,
  },
  // No image domains configured yet. UI work is Phase 7+ per the
  // Project Implementation Plan.
};

export default nextConfig;
