import { getRealmView, listRealms, needsBootstrap } from '@card-engine/db';
import { redirect } from 'next/navigation';
import { currentAccount, db } from '../lib/server';
import { Dashboard, SignIn } from './ui';
import { discordErrors, discordSettings } from '../lib/discord';
import { toClientView } from '../lib/client-view';
import { screenHref, type GameScreen } from './screens';
export type GameSearchParams = Promise<{
  realm?: string;
  authError?: string;
  task?: string;
  pack?: string;
  /** Profile screen: the trade code of the player to show. */
  player?: string;
  /** Profile screen: "players" opens the directory. */
  view?: string;
  /** Trades screen: the trade code of the player to start an offer with. */
  with?: string;
}>;
export async function GamePage({
  searchParams,
  screen = 'packs',
}: {
  searchParams: GameSearchParams;
  screen?: GameScreen;
}) {
  const account = await currentAccount(),
    params = await searchParams,
    discordEnabled = !!discordSettings(process.env);
  if (!account)
    return (
      <SignIn
        discordEnabled={discordEnabled}
        bootstrapNeeded={await needsBootstrap(db())}
        initialError={
          params.authError && Object.hasOwn(discordErrors, params.authError)
            ? discordErrors[params.authError]
            : ''
        }
      />
    );
  const realms = await listRealms(db(), account.id),
    active = realms.find((realm) => realm.id === params.realm) ?? realms[0],
    view = active ? toClientView(await getRealmView(db(), account.id, active.id)) : null;
  if (screen === 'admin' && !account.instanceAdmin && view?.role !== 'admin')
    redirect(screenHref('packs', view?.id));
  return (
    <Dashboard
      account={account}
      realms={realms}
      view={view}
      discordEnabled={discordEnabled}
      screen={screen}
      initialTask={params.task}
      initialPack={typeof params.pack === 'string' ? params.pack : undefined}
      profilePlayer={typeof params.player === 'string' ? params.player : undefined}
      profileView={params.view === 'players' ? 'players' : 'profile'}
      tradePartner={typeof params.with === 'string' ? params.with : undefined}
    />
  );
}
