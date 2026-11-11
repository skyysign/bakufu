import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  adminMemberCollection,
  adminCollectionCommand,
  realmTierAdjustments,
  previewTierFloors,
  applyTierFloors,
  setTierOverride,
  realmGenderGaps,
  setRealmCharacterGenders,
  tagRealmSeries,
  retireRealmPack,
  recentPulls,
  pullFeedChanged,
  setTierSound,
  removeTierSound,
  readTierSound,
  setCharacterSound,
  removeCharacterSound,
  readCharacterSound,
  addRealmPacks,
  addRealmCharacters,
  checkRealmCharacters,
  realmCharacterSummary,
  browseRealmCatalog,
  realmPackPlan,
  createRealm,
  previewRealmCatalog,
  catalogRequestBytes,
  providerCatalogRequestBytes,
  exportPlayer,
  login,
  logout,
  openPack,
  inviteDiscordPlayer,
  recycleCard,
  recycleCards,
  tradePartnerCards,
  previewCharacterRemoval,
  removeCharacters,
  buyUpgrade,
  setWishlistEntry,
  addWishlistEntries,
  previewRealmSettings,
  applyRealmSettings,
  tradeCommand,
  setDiscordGuild,
  listRealmMembers,
  getPlayerProfile,
  listPlayers,
  updateProfilePage,
  configureAdmission,
  buyCollectorRank,
  buyRankTrackLevel,
  claimGems,
  fetchProviderCatalog,
  listMarket,
  marketCommand,
  changePassword,
} from '@card-engine/db';
import { GameError } from '@card-engine/core';
import {
  db,
  cookieOptions,
  requireAccount,
  sessionCookie,
  verifyOrigin,
} from '../../../lib/server';
import { readJsonBody } from '../../../lib/request-body';
import {
  discordErrors,
  discordSettings,
  startDiscordLogin,
  finishDiscordLoginResult,
  DiscordJoinError,
} from '../../../lib/discord';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Large realm creation can take a while; hosts with per-request limits (such
// as Vercel) allow up to 60 seconds. Self-hosted servers ignore this.
export const maxDuration = 60;
type Context = { params: Promise<{ path: string[] }> };
const discordCookie = 'card_engine_discord_flow';
const discordCookieOptions = () => ({
  ...cookieOptions(),
  sameSite: 'lax' as const,
  path: '/api/auth/discord',
  maxAge: 600,
});

const body = readJsonBody;
function errorResponse(error: unknown) {
  if (error instanceof GameError)
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  if (error instanceof Error && error.name === 'ZodError')
    return NextResponse.json(
      { error: 'Some fields are invalid. Check the form and try again.' },
      { status: 400 },
    );
  // Avoid exposing SQL, connection strings, passwords, or submitted payloads.
  return NextResponse.json(
    {
      error:
        'The request could not be completed. Check the database connection or retry the same request.',
    },
    { status: 500 },
  );
}
export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const path = (await context.params).path.join('/');
    if (path === 'auth/discord/start') {
      const settings = discordSettings(process.env);
      if (!settings) throw new GameError('DISCORD_DISABLED', discordErrors.DISCORD_DISABLED, 503);
      const input = await body(request);
      const flow = await startDiscordLogin(
        db(),
        settings,
        input.joinCode === undefined ? undefined : String(input.joinCode),
      );
      (await cookies()).set(discordCookie, flow.browserToken, discordCookieOptions());
      return NextResponse.json({ url: flow.url });
    }
    if (path === 'login') {
      const input = await body(request);
      const token = await login(db(), String(input.email ?? ''), String(input.password ?? ''));
      (await cookies()).set(sessionCookie, token, cookieOptions());
      return NextResponse.json({ ok: true });
    }
    const actor = await requireAccount();
    if (path === 'logout') {
      await logout(db(), (await cookies()).get(sessionCookie)?.value);
      (await cookies()).delete(sessionCookie);
      return NextResponse.json({ ok: true });
    }
    // Realm creation carries the reviewed catalog; provider rosters can reach
    // 100,000 characters. The service enforces the per-catalog-kind limit.
    const input = await body(
      request,
      actor.instanceAdmin && ['realms', 'realms/preview'].includes(path)
        ? providerCatalogRequestBytes
        : actor.instanceAdmin && path === 'catalog/provider'
          ? catalogRequestBytes
          : actor.instanceAdmin && path.startsWith('realm-characters')
            ? 512 * 1024
            : path === 'tier-sounds' || path === 'character-sounds'
              ? 6 * 1024 * 1024
              : 16384,
    );
    if (path === 'gems/claim')
      return NextResponse.json(
        await claimGems(
          db(),
          actor.id,
          String(input.realmId ?? ''),
          String(input.requestKey ?? ''),
          (input.expectedRevision as number | undefined) ?? 0,
        ),
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    if (path === 'catalog/provider')
      return NextResponse.json(await fetchProviderCatalog(db(), actor.id, input), {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    if (path === 'ranks/track')
      return NextResponse.json(
        await buyRankTrackLevel(
          db(),
          actor.id,
          String(input.realmId ?? ''),
          String(input.trackId ?? ''),
          input.level as number,
          String(input.requestKey ?? ''),
          (input.expectedRevision as number | undefined) ?? 0,
        ),
      );
    if (path === 'ranks/buy')
      return NextResponse.json(
        await buyCollectorRank(
          db(),
          actor.id,
          String(input.realmId ?? ''),
          input.rank as number,
          String(input.requestKey ?? ''),
          (input.expectedRevision as number | undefined) ?? 0,
        ),
      );
    if (path === 'admin-collection')
      return NextResponse.json(
        await adminCollectionCommand(db(), actor.id, String(input.realmId ?? ''), input.command),
      );
    if (path === 'character-removal/preview')
      return NextResponse.json(
        await previewCharacterRemoval(db(), actor.id, String(input.realmId ?? ''), input.selection),
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    if (path === 'character-removal')
      return NextResponse.json(
        await removeCharacters(db(), actor.id, String(input.realmId ?? ''), {
          selection: input.selection,
          previewHash: input.previewHash,
          requestKey: input.requestKey,
        }),
      );
    if (path === 'tier-adjustments/preview')
      return NextResponse.json(
        await previewTierFloors(db(), actor.id, String(input.realmId ?? ''), {
          floors: input.floors,
        }),
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    if (path === 'tier-adjustments/apply')
      return NextResponse.json(
        await applyTierFloors(db(), actor.id, String(input.realmId ?? ''), {
          floors: input.floors,
          previewHash: input.previewHash,
          requestKey: input.requestKey,
        }),
      );
    if (path === 'tier-adjustments/override')
      return NextResponse.json(
        await setTierOverride(db(), actor.id, String(input.realmId ?? ''), {
          characterId: input.characterId,
          tier: input.tier ?? null,
          requestKey: input.requestKey,
        }),
      );
    if (path === 'realm-packs')
      return NextResponse.json(
        await addRealmPacks(db(), actor.id, String(input.realmId ?? ''), { packs: input.packs }),
      );
    if (path === 'tier-sounds')
      return NextResponse.json({
        tierSounds: await setTierSound(db(), actor.id, String(input.realmId ?? ''), {
          tier: input.tier,
          fileName: input.fileName,
          audio: input.audio,
          rightsConfirmed: input.rightsConfirmed,
        }),
      });
    if (path === 'character-sounds')
      return NextResponse.json({
        characterSounds: await setCharacterSound(db(), actor.id, String(input.realmId ?? ''), {
          characterId: input.characterId,
          fileName: input.fileName,
          audio: input.audio,
          rightsConfirmed: input.rightsConfirmed,
        }),
      });
    if (path === 'character-sounds/remove')
      return NextResponse.json({
        characterSounds: await removeCharacterSound(
          db(),
          actor.id,
          String(input.realmId ?? ''),
          input.characterId,
        ),
      });
    if (path === 'tier-sounds/remove')
      return NextResponse.json({
        tierSounds: await removeTierSound(db(), actor.id, String(input.realmId ?? ''), input.tier),
      });
    if (path === 'realm-packs/remove')
      return NextResponse.json(
        await retireRealmPack(db(), actor.id, String(input.realmId ?? ''), input.packId),
      );
    if (path === 'realm-characters/genders')
      return NextResponse.json(
        await setRealmCharacterGenders(db(), actor.id, String(input.realmId ?? ''), {
          genders: input.genders,
          rightsConfirmed: input.rightsConfirmed,
        }),
      );
    if (path === 'realm-characters/series-tags')
      return NextResponse.json(
        await tagRealmSeries(db(), actor.id, String(input.realmId ?? ''), { tags: input.tags }),
      );
    if (path === 'realm-characters/check')
      return NextResponse.json(
        await checkRealmCharacters(db(), actor.id, String(input.realmId ?? ''), {
          characters: input.characters,
        }),
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    if (path === 'realm-characters')
      return NextResponse.json(
        await addRealmCharacters(db(), actor.id, String(input.realmId ?? ''), {
          characters: input.characters,
          rightsConfirmed: input.rightsConfirmed,
        }),
      );
    if (path === 'market')
      return NextResponse.json(
        await marketCommand(
          db(),
          actor.id,
          String(input.realmId ?? ''),
          input.command,
          String(input.requestKey ?? ''),
          (input.expectedRevision as number | undefined) ?? 0,
        ),
      );
    if (path === 'account/password')
      return NextResponse.json(
        await changePassword(
          db(),
          actor.id,
          (await cookies()).get(sessionCookie)?.value,
          input.expectedRevision,
          String(input.currentPassword ?? ''),
          String(input.newPassword ?? ''),
        ),
      );
    if (path === 'admission')
      return NextResponse.json(
        await configureAdmission(
          db(),
          actor.id,
          String(input.realmId ?? ''),
          input.policy,
          input.expectedRevision as number,
          String(input.requestKey ?? ''),
        ),
      );
    if (path === 'discord/guild')
      return NextResponse.json(
        await setDiscordGuild(
          db(),
          actor.id,
          String(input.realmId ?? ''),
          input.guildId === null ? null : String(input.guildId ?? ''),
        ),
      );
    if (path === 'discord/invite') {
      await inviteDiscordPlayer(
        db(),
        actor.id,
        String(input.realmId ?? ''),
        String(input.discordId ?? ''),
      );
      return NextResponse.json({ ok: true });
    }
    if (path === 'realms/preview')
      return NextResponse.json(
        await previewRealmCatalog(db(), actor.id, input.config, input.catalog, input.packPlan),
      );
    if (path === 'realms') {
      const id = await createRealm(
        db(),
        actor.id,
        String(input.name ?? ''),
        input.config,
        input.catalog,
        input.expectedPreview as string | undefined,
        input.packPlan,
        input.requestKey ?? null,
      );
      return NextResponse.json({ id }, { status: 201 });
    }
    if (path === 'open') {
      const result = await openPack(
        db(),
        actor.id,
        String(input.realmId ?? ''),
        String(input.packId ?? ''),
        String(input.requestKey ?? ''),
        (input.expectedRevision as number | undefined) ?? 0,
        (input.packCount as number | undefined) ?? 1,
      );
      return NextResponse.json(result);
    }
    if (path === 'trades')
      return NextResponse.json(
        await tradeCommand(
          db(),
          actor.id,
          String(input.realmId ?? ''),
          input.command,
          String(input.requestKey ?? ''),
          (input.expectedRevision as number | undefined) ?? 0,
        ),
      );
    if (path === 'settings/preview') {
      return NextResponse.json(
        await previewRealmSettings(db(), actor.id, String(input.realmId ?? ''), input.config),
      );
    }
    if (path === 'settings/apply') {
      return NextResponse.json(
        await applyRealmSettings(
          db(),
          actor.id,
          String(input.realmId ?? ''),
          String(input.previewId ?? ''),
          String(input.requestKey ?? ''),
        ),
      );
    }
    if (path === 'wishlist/batch')
      return NextResponse.json(
        await addWishlistEntries(db(), actor.id, String(input.realmId ?? ''), {
          characterIds: input.characterIds,
          requestKey: input.requestKey,
          expectedRevision: (input.expectedRevision as number | undefined) ?? 0,
        }),
      );
    if (path === 'wishlist') {
      return NextResponse.json(
        await setWishlistEntry(
          db(),
          actor.id,
          String(input.realmId ?? ''),
          String(input.characterId ?? ''),
          input.present as boolean,
          String(input.requestKey ?? ''),
          (input.expectedRevision as number | undefined) ?? 0,
        ),
      );
    }
    if (path === 'upgrades/buy') {
      const result = await buyUpgrade(
        db(),
        actor.id,
        String(input.realmId ?? ''),
        String(input.upgradeId ?? ''),
        input.targetRank as number,
        String(input.requestKey ?? ''),
        (input.expectedRevision as number | undefined) ?? 0,
      );
      return NextResponse.json(result);
    }
    if (path === 'recycle') {
      const result = await recycleCard(
        db(),
        actor.id,
        String(input.realmId ?? ''),
        String(input.cardId ?? ''),
        String(input.requestKey ?? ''),
        (input.expectedRevision as number | undefined) ?? 0,
        input.confirmed === true,
      );
      return NextResponse.json(result);
    }
    if (path === 'profile')
      return NextResponse.json(
        await updateProfilePage(db(), actor.id, String(input.realmId ?? ''), {
          bio: input.bio,
          theme: input.theme,
          showcase: input.showcase,
          showWishlist: input.showWishlist,
        }),
      );
    if (path === 'recycle/batch')
      return NextResponse.json(
        await recycleCards(db(), actor.id, String(input.realmId ?? ''), {
          cardIds: input.cardIds,
          requestKey: input.requestKey,
          expectedRevision: (input.expectedRevision as number | undefined) ?? 0,
        }),
      );
    return NextResponse.json({ error: 'Route not found.' }, { status: 404 });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function GET(request: Request, context: Context) {
  try {
    const path = (await context.params).path.join('/');
    if (path === 'auth/discord/callback') {
      const origin = new URL(process.env.APP_ORIGIN ?? '').origin;
      const jar = await cookies();
      const browserToken = jar.get(discordCookie)?.value ?? '';
      jar.set(discordCookie, '', { ...discordCookieOptions(), maxAge: 0 });
      let destination = '/';
      try {
        const settings = discordSettings(process.env);
        if (!settings) throw new GameError('DISCORD_DISABLED', discordErrors.DISCORD_DISABLED, 503);
        const result = await finishDiscordLoginResult(
          db(),
          settings,
          new URL(request.url).searchParams,
          browserToken,
        );
        jar.set(sessionCookie, result.token, cookieOptions());
        if (result.realmId) destination = `/?realm=${result.realmId}`;
      } catch (error) {
        const code =
          error instanceof GameError && Object.hasOwn(discordErrors, error.code)
            ? error.code
            : 'DISCORD_PROVIDER';
        destination =
          error instanceof DiscordJoinError
            ? `/join/${error.joinCode}?authError=${code}`
            : `/?authError=${code}`;
      }
      const response = NextResponse.redirect(new URL(destination, origin), 303);
      response.headers.set('Referrer-Policy', 'no-referrer');
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    }
    if (path === 'market') {
      const actor = await requireAccount(),
        query = new URL(request.url).searchParams;
      return NextResponse.json(
        await listMarket(db(), actor.id, query.get('realmId') ?? '', {
          query: query.get('query') ?? '',
          scope: (query.get('scope') ?? 'all') as 'all' | 'mine',
          offset: Number(query.get('offset') ?? 0),
        }),
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    if (path === 'admin-collection') {
      const actor = await requireAccount(),
        query = new URL(request.url).searchParams;
      return NextResponse.json(
        await adminMemberCollection(
          db(),
          actor.id,
          query.get('realmId') ?? '',
          query.get('member') ?? '',
        ),
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    if (path === 'tier-adjustments') {
      const actor = await requireAccount();
      return NextResponse.json(
        await realmTierAdjustments(
          db(),
          actor.id,
          new URL(request.url).searchParams.get('realmId') ?? '',
        ),
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    if (path === 'trade-partner') {
      const actor = await requireAccount(),
        query = new URL(request.url).searchParams;
      return NextResponse.json(
        await tradePartnerCards(
          db(),
          actor.id,
          query.get('realmId') ?? '',
          query.get('code') ?? '',
        ),
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    if (path === 'realm-packs') {
      const actor = await requireAccount();
      return NextResponse.json(
        await realmPackPlan(db(), actor.id, new URL(request.url).searchParams.get('realmId') ?? ''),
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    if (path === 'pulls') {
      const actor = await requireAccount(),
        query = new URL(request.url).searchParams,
        realmId = query.get('realmId') ?? '',
        after = query.get('after');
      // Timed polls name the newest opening they show; answer "unchanged"
      // without re-sending the feed when nothing newer was pulled.
      if (after && !(await pullFeedChanged(db(), actor.id, realmId, after)))
        return NextResponse.json(
          { unchanged: true },
          { headers: { 'Cache-Control': 'private, no-store' } },
        );
      return NextResponse.json(await recentPulls(db(), actor.id, realmId), {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }
    if (path === 'tier-sound' || path === 'character-sound') {
      const actor = await requireAccount(),
        query = new URL(request.url).searchParams;
      const sound =
        path === 'tier-sound'
          ? await readTierSound(db(), actor.id, query.get('realmId') ?? '', query.get('tier') ?? '')
          : await readCharacterSound(
              db(),
              actor.id,
              query.get('realmId') ?? '',
              query.get('characterId') ?? '',
            );
      if (!sound) return NextResponse.json({ error: 'No custom sound.' }, { status: 404 });
      return new NextResponse(new Uint8Array(sound.audio), {
        headers: {
          'Content-Type': 'audio/wav',
          'Content-Length': String(sound.audio.byteLength),
          'Cache-Control': 'private, max-age=86400',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    if (path === 'realm-characters/genders') {
      const actor = await requireAccount();
      return NextResponse.json(
        await realmGenderGaps(
          db(),
          actor.id,
          new URL(request.url).searchParams.get('realmId') ?? '',
        ),
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    if (path === 'realm-characters') {
      const actor = await requireAccount();
      return NextResponse.json(
        await realmCharacterSummary(
          db(),
          actor.id,
          new URL(request.url).searchParams.get('realmId') ?? '',
        ),
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    if (path === 'catalog') {
      const actor = await requireAccount(),
        query = new URL(request.url).searchParams;
      return NextResponse.json(
        await browseRealmCatalog(db(), actor.id, query.get('realmId') ?? '', {
          query: query.get('query') ?? '',
          tier: query.get('tier') ?? 'all',
          status: query.get('status') ?? 'all',
          excludeWished: query.get('excludeWished') === 'true',
          offset: Number(query.get('offset') ?? 0),
          limit: Number(query.get('limit') ?? 24),
        }),
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    if (path === 'profile') {
      const actor = await requireAccount(),
        query = new URL(request.url).searchParams;
      return NextResponse.json(
        await getPlayerProfile(
          db(),
          actor.id,
          query.get('realmId') ?? '',
          query.get('player') || undefined,
        ),
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    if (path === 'players') {
      const actor = await requireAccount(),
        query = new URL(request.url).searchParams;
      return NextResponse.json(
        await listPlayers(db(), actor.id, query.get('realmId') ?? '', {
          query: query.get('query') ?? '',
          ...(query.has('sort') ? { sort: query.get('sort') } : {}),
          ...(query.has('offset') ? { offset: Number(query.get('offset')) } : {}),
        }),
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    if (path === 'members') {
      const actor = await requireAccount(),
        query = new URL(request.url).searchParams;
      return NextResponse.json(
        await listRealmMembers(db(), actor.id, query.get('realmId') ?? '', {
          query: query.get('query') ?? '',
          ...(query.has('cursor') ? { cursor: query.get('cursor') } : {}),
        }),
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    if (path !== 'export') return NextResponse.json({ error: 'Route not found.' }, { status: 404 });
    const actor = await requireAccount();
    const archive = await exportPlayer(
      db(),
      actor.id,
      new URL(request.url).searchParams.get('realmId') ?? '',
    );
    return NextResponse.json(archive, {
      headers: {
        'Content-Disposition': `attachment; filename="card-engine-player-${archive.realm.id}.json"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
