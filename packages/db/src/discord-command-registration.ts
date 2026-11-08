import { z } from 'zod';
import {
  discordCommandDefinition,
  discordCommandName,
  legacyDiscordCommandName,
} from './discord-protocol';
import { discordIdSchema } from './discord';

// Explicit operator action only. Runtime gameplay makes no outbound API requests.
export async function registerDiscordCommands(
  applicationId: string,
  clientSecret: string,
  guildId: string,
  request: typeof fetch = fetch,
) {
  discordIdSchema.parse(applicationId);
  discordIdSchema.parse(guildId);
  z.string().min(1).max(1024).parse(clientSecret);
  const tokenResponse = await request('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: `Basic ${Buffer.from(`${applicationId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'applications.commands.update',
    }),
  });
  if (!tokenResponse.ok)
    throw new Error('Discord command authorization failed. Check the application credentials.');
  const token = z
    .object({
      access_token: z.string().min(1),
      token_type: z.string().refine((value) => value.toLowerCase() === 'bearer'),
    })
    .parse(await tokenResponse.json());
  const response = await request(
    `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`,
    {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(discordCommandDefinition),
    },
  );
  if (!response.ok)
    throw new Error(
      'Discord command registration failed. Check that the application is installed in this server.',
    );
  // Remove the command's former name (/atlas) so members only see /bakufu.
  // Best effort: the new command is already registered if this step fails.
  const headers = { Authorization: `Bearer ${token.access_token}` };
  const listed = await request(
    `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`,
    { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000), headers },
  ).catch(() => null);
  if (!listed?.ok) return { legacyRemoved: false };
  const commands = z
    .array(z.object({ id: discordIdSchema, name: z.string() }).passthrough())
    .safeParse(await listed.json().catch(() => null));
  const legacy = commands.success
    ? commands.data.filter((command) => command.name === legacyDiscordCommandName)
    : [];
  let legacyRemoved = false;
  for (const command of legacy) {
    const removed = await request(
      `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands/${command.id}`,
      { method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(10000), headers },
    ).catch(() => null);
    legacyRemoved ||= !!removed?.ok;
  }
  return { legacyRemoved };
}

/**
 * Removes this application's /bakufu (and former /atlas) commands from one
 * server, for hosting without the interactions endpoint (for example Vercel +
 * Neon, where players use the website and Discord sign-in only).
 */
export async function removeDiscordCommands(
  applicationId: string,
  clientSecret: string,
  guildId: string,
  request: typeof fetch = fetch,
): Promise<{ removed: number }> {
  discordIdSchema.parse(applicationId);
  discordIdSchema.parse(guildId);
  z.string().min(1).max(1024).parse(clientSecret);
  const tokenResponse = await request('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: `Basic ${Buffer.from(`${applicationId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'applications.commands.update',
    }),
  });
  if (!tokenResponse.ok)
    throw new Error('Discord command authorization failed. Check the application credentials.');
  const token = z
    .object({
      access_token: z.string().min(1),
      token_type: z.string().refine((value) => value.toLowerCase() === 'bearer'),
    })
    .parse(await tokenResponse.json());
  const headers = { Authorization: `Bearer ${token.access_token}` };
  const base = `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`;
  const listed = await request(base, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
    headers,
  });
  if (!listed.ok)
    throw new Error(
      'Could not list commands. Check that the application is installed in this server.',
    );
  const commands = z
    .array(z.object({ id: discordIdSchema, name: z.string() }).passthrough())
    .parse(await listed.json())
    .filter((command) => [discordCommandName, legacyDiscordCommandName].includes(command.name));
  let removed = 0;
  for (const command of commands) {
    const response = await request(`${base}/${command.id}`, {
      method: 'DELETE',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers,
    });
    if (!response.ok) throw new Error('Discord refused to remove a command.');
    removed++;
  }
  return { removed };
}
