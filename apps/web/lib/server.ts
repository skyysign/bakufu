import { cookies } from 'next/headers';
import { authenticate, createDatabase, type Database } from '@card-engine/db';
import { GameError } from '@card-engine/core';

const globalDb = globalThis as typeof globalThis & { cardEngineDb?: Database };
export function db(): Database {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be configured.');
  return (globalDb.cardEngineDb ??= createDatabase(process.env.DATABASE_URL));
}
export const sessionCookie = 'card_engine_session';
export const cookieOptions = () => ({
  httpOnly: true,
  // Lax allows the top-level return from Discord; every HTTP mutation also checks Origin.
  sameSite: 'lax' as const,
  secure: process.env.COOKIE_SECURE === 'true',
  path: '/',
  maxAge: 7 * 86400,
});
export async function currentAccount() {
  return authenticate(db(), (await cookies()).get(sessionCookie)?.value);
}
export async function requireAccount() {
  const account = await currentAccount();
  if (!account) throw new GameError('UNAUTHORIZED', 'Please sign in.', 401);
  return account;
}
export function verifyOrigin(request: Request) {
  const configured = process.env.APP_ORIGIN;
  if (!configured) throw new Error('APP_ORIGIN must be configured.');
  const origin = new URL(configured);
  if (!['http:', 'https:'].includes(origin.protocol))
    throw new Error('APP_ORIGIN must be HTTP or HTTPS.');
  if (request.headers.get('origin') !== origin.origin)
    throw new GameError('FORBIDDEN', 'Request origin is not allowed.', 403);
}
