import { publicJoinTarget } from '@card-engine/db';
import type { Metadata } from 'next';
import { db } from '../../../lib/server';
import { discordSettings, discordErrors } from '../../../lib/discord';
import { JoinRealm } from '../../join-realm';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Join a realm',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ authError?: string }>;
}) {
  const { code } = await params,
    query = await searchParams;
  let target: null | Awaited<ReturnType<typeof publicJoinTarget>> = null;
  try {
    target = await publicJoinTarget(db(), code);
  } catch {
    /* Closed or malformed links expose no realm information. */
  }
  const error =
    query.authError && Object.hasOwn(discordErrors, query.authError)
      ? discordErrors[query.authError]
      : '';
  return (
    <main id="main" className="shell">
      <a className="brand" href="/">
        Card Engine
      </a>
      {target ? (
        <JoinRealm
          code={target.joinCode}
          name={target.name}
          guildId={target.guildId}
          enabled={!!discordSettings(process.env)}
          initialError={error}
        />
      ) : (
        <section className="panel">
          <h1>Join link unavailable</h1>
          <p>
            This link is closed or invalid. Ask the realm administrator for a current link or
            invitation.
          </p>
          <a href="/">Go to sign-in</a>
        </section>
      )}
    </main>
  );
}
