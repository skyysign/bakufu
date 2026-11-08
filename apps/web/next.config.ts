import type { NextConfig } from 'next';

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
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://cdn.myanimelist.net https://s4.anilist.co https://cdn.discordapp.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
          },
          { key: 'Cache-Control', value: 'private, no-store' },
        ],
      },
      {
        source: '/api/auth/discord/callback',
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      },
    ];
  },
};
export default config;
