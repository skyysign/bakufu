import { z } from 'zod';
import {
  beginDiscordFlow,
  consumeDiscordFlowContext,
  loginDiscord,
  publicJoinTarget,
  type Database,
} from '@card-engine/db';
import { GameError } from '@card-engine/core';
import { discordNamesSchema, type DiscordNames } from '../../../packages/db/src/member-profiles';
import { type AdmissionTarget, type VerifiedAdmission } from '../../../packages/db/src/admission';
import { discordAvatarUrl } from '../../../packages/config/src/discord-avatar';

const subjectSchema = z.string().regex(/^[0-9]{17,20}$/);
export type DiscordSettings = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  adminId?: string;
};
export function discordSettings(env: Record<string, string | undefined>): DiscordSettings | null {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) return null;
  const clientId = subjectSchema.parse(env.DISCORD_CLIENT_ID);
  const origin = new URL(env.APP_ORIGIN ?? '');
  if (!['http:', 'https:'].includes(origin.protocol))
    throw new Error('Configure an HTTP(S) APP_ORIGIN.');
  return {
    clientId,
    clientSecret: env.DISCORD_CLIENT_SECRET,
    redirectUri: new URL('/api/auth/discord/callback', origin.origin).href,
    adminId: env.DISCORD_ADMIN_USER_ID ? subjectSchema.parse(env.DISCORD_ADMIN_USER_ID) : undefined,
  };
}

export async function startDiscordLogin(
  db: Database,
  settings: DiscordSettings,
  joinCode?: string,
) {
  let admission: AdmissionTarget | undefined;
  if (joinCode) {
    const target = await publicJoinTarget(db, joinCode);
    admission = {
      realmId: target.realmId,
      guildId: target.guildId,
      revision: target.revision,
      joinCode: target.joinCode,
    };
  }
  const flow = await beginDiscordFlow(db, admission);
  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({
    client_id: settings.clientId,
    redirect_uri: settings.redirectUri,
    response_type: 'code',
    scope: admission ? 'identify guilds.members.read' : 'identify',
    state: flow.state,
    code_challenge: flow.challenge,
    code_challenge_method: 'S256',
  }).toString();
  return { url: url.href, browserToken: flow.browserToken };
}

export async function exchangeDiscordCode(
  settings: DiscordSettings,
  code: string,
  verifier: string,
  fetcher: typeof fetch = fetch,
  target?: AdmissionTarget,
): Promise<{ id: string; profile: DiscordNames | null; admission?: VerifiedAdmission }> {
  try {
    const tokenResponse = await fetcher('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        code,
        code_verifier: verifier,
        redirect_uri: settings.redirectUri,
      }),
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!tokenResponse.ok) throw new Error();
    const token = z
      .object({
        access_token: z.string().min(1).max(4096),
        token_type: z.string(),
        scope: z.string(),
      })
      .parse(await tokenResponse.json());
    if (token.token_type.toLowerCase() !== 'bearer' || !token.scope.split(' ').includes('identify'))
      throw new Error();
    if (target && !token.scope.split(' ').includes('guilds.members.read'))
      throw new GameError(
        'JOIN_UNVERIFIED',
        'Discord server membership permission was not granted. Open the join link and try again.',
        403,
      );
    const userResponse = await fetcher('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${token.access_token}` },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!userResponse.ok) throw new Error();
    // The ID authenticates. Optional verified names are presentation only.
    const user = z
      .object({
        id: subjectSchema,
        username: z.unknown().optional(),
        global_name: z.unknown().optional(),
        avatar: z.unknown().optional(),
        discriminator: z.unknown().optional(),
      })
      .parse(await userResponse.json());
    const avatarUrl = discordAvatarUrl(user.id, user.avatar, user.discriminator);
    const profile = discordNamesSchema.safeParse({
      username: user.username,
      displayName: user.global_name ?? null,
      ...(avatarUrl ? { avatarUrl } : {}),
    });
    if (target) {
      const membership = await fetcher(
        `https://discord.com/api/v10/users/@me/guilds/${target.guildId}/member`,
        {
          headers: { Authorization: `Bearer ${token.access_token}` },
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(10000),
        },
      );
      if (membership.status === 403 || membership.status === 404)
        throw new GameError(
          'JOIN_UNVERIFIED',
          'This Discord account is not an eligible member of the required server. Complete server screening and try again.',
          403,
        );
      if (!membership.ok) throw new Error();
      const member = z
        .object({ user: z.object({ id: subjectSchema }), pending: z.boolean().optional() })
        .parse(await membership.json());
      if (member.user.id !== user.id || member.pending === true)
        throw new GameError(
          'JOIN_UNVERIFIED',
          'Discord server membership could not be verified. Complete server screening and try again.',
          403,
        );
      return {
        id: user.id,
        profile: profile.success ? profile.data : null,
        admission: { ...target, verifiedAt: Date.now() },
      };
    }
    return { id: user.id, profile: profile.success ? profile.data : null };
  } catch (error) {
    if (error instanceof GameError && error.code === 'JOIN_UNVERIFIED') throw error;
    throw new GameError(
      'DISCORD_PROVIDER',
      'Discord sign-in could not be completed. Please try again.',
      502,
    );
  }
}

export class DiscordJoinError extends GameError {
  constructor(
    error: unknown,
    readonly joinCode: string,
  ) {
    super(
      error instanceof GameError ? error.code : 'DISCORD_PROVIDER',
      error instanceof GameError ? error.message : 'Discord joining could not be completed.',
      error instanceof GameError ? error.status : 502,
    );
  }
}
export async function finishDiscordLoginResult(
  db: Database,
  settings: DiscordSettings,
  query: URLSearchParams,
  browserToken: string,
  fetcher: typeof fetch = fetch,
) {
  const flow = await consumeDiscordFlowContext(db, query.get('state') ?? '', browserToken);
  try {
    if (query.has('error'))
      throw new GameError('DISCORD_CANCELLED', 'Discord sign-in was cancelled.', 400);
    const code = query.get('code');
    if (!code || code.length > 2048 || query.get('iss') !== 'https://discord.com')
      throw new GameError(
        'OAUTH_STATE',
        'Discord sign-in could not be verified. Please try again.',
        400,
      );
    const user = await exchangeDiscordCode(
      settings,
      code,
      flow.verifier,
      fetcher,
      flow.admission ?? undefined,
    );
    const token = await loginDiscord(db, user.id, settings.adminId, user.profile, user.admission);
    return { token, realmId: flow.admission?.realmId ?? null };
  } catch (error) {
    if (flow.admission) throw new DiscordJoinError(error, flow.admission.joinCode);
    throw error;
  }
}
export async function finishDiscordLogin(
  db: Database,
  settings: DiscordSettings,
  query: URLSearchParams,
  browserToken: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  return (await finishDiscordLoginResult(db, settings, query, browserToken, fetcher)).token;
}

export const discordErrors: Record<string, string> = {
  JOIN_UNVERIFIED:
    'Discord server membership could not be verified. Join the required server, finish its screening, and try again.',
  JOIN_UNAVAILABLE:
    'This join link is closed or its settings changed. Ask the realm administrator for a current link or invitation.',
  DISCORD_NOT_INVITED:
    'Your Discord account has not been invited. Ask your realm administrator for access.',
  OAUTH_STATE: 'Discord sign-in expired or could not be verified. Please try again.',
  DISCORD_CANCELLED: 'Discord sign-in was cancelled. You can try again or use your local account.',
  DISCORD_PROVIDER: 'Discord sign-in could not be completed. Please try again.',
  DISCORD_DISABLED: 'Discord sign-in has not been configured on this instance.',
};
