import type { NextConfig } from 'next';

// Development needs eval for React's debugging tools; a production build does not.
const scriptSources =
  process.env.NODE_ENV === 'production'
    ? "'self' 'unsafe-inline'"
    : "'self' 'unsafe-inline' 'unsafe-eval'";

const config: NextConfig = {
  transpilePackages: ['@card-engine/core', '@card-engine/config', '@card-engine/db'],
  poweredByHeader: false,
  // Authorization codes and state values must not appear in development request logs.
  logging: { incomingRequests: { ignore: [/\/api\/auth\/discord\/callback/] } },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          {
            key: 'Content-Security-Policy',
            value: `default-src 'self'; script-src ${scriptSources}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://cdn.myanimelist.net https://s4.anilist.co https://cdn.discordapp.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
          },
        ],
      },
      {
        // Pages and the API can show signed-in data, so browsers never store them.
        // Build files under /_next/static have a content hash in their names; left
        // without a header here, Next.js marks them cacheable for a year, so a page
        // load doesn't download every script and font again.
        source: '/((?!_next/static/).*)',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
      {
        source: '/api/auth/discord/callback',
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      },
    ];
  },
};
export default config;
