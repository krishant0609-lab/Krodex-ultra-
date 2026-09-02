// apps/web — extends the root ESLint config with Next.js presets.
// Required by the Next.js 14 tooling (next/core-web-vitals +
// next/typescript) and silences the "Next.js plugin was not detected"
// warning during `next build`.
module.exports = {
  root: false,
  extends: [
    'next/core-web-vitals',
    'next/typescript',
    '../../.eslintrc.cjs',
  ],
  ignorePatterns: ['.next/', 'node_modules/', 'next-env.d.ts'],
};
