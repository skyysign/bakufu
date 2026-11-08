import { createHash, createPublicKey, verify } from 'node:crypto';
import { z } from 'zod';
import { GameError } from '../../core/src/index';

/** The slash command (/bakufu). Its former name /atlas is still accepted. */
export const discordCommandName = 'bakufu';
export const legacyDiscordCommandName = 'atlas';

const snowflake = z.string().regex(/^[0-9]{17,20}$/);
export type DiscordInteractionSettings = { applicationId: string; publicKey: string };
export function discordInteractionSettings(
  env: Record<string, string | undefined>,
): DiscordInteractionSettings | null {
  if (!env.DISCORD_PUBLIC_KEY) return null;
  return {
    applicationId: snowflake.parse(env.DISCORD_CLIENT_ID),
    publicKey: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .parse(env.DISCORD_PUBLIC_KEY),
  };
}
export function verifyDiscordSignature(
  body: Uint8Array,
  signature: string | null,
  timestamp: string | null,
  publicKey: string,
  now = Date.now(),
) {
  if (
    !signature ||
    !timestamp ||
    !/^[a-fA-F0-9]{128}$/.test(signature) ||
    !/^\d{10}$/.test(timestamp) ||
    !/^[a-fA-F0-9]{64}$/.test(publicKey) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300
  )
    return false;
  try {
    const key = createPublicKey({
      key: Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'),
        Buffer.from(publicKey, 'hex'),
      ]),
      format: 'der',
      type: 'spki',
    });
    return verify(
      null,
      Buffer.concat([Buffer.from(timestamp), body]),
      key,
      Buffer.from(signature, 'hex'),
    );
  } catch {
    return false;
  }
}
export type DiscordAction = { id: string; guildId: string; subject: string } & (
  | { kind: 'status' }
  | { kind: 'packs' }
  | { kind: 'collection'; page: number; share: boolean }
  | { kind: 'quote'; pack: string }
  | { kind: 'confirm'; quoteId: string }
);
const payloadSchema = z.object({
  id: snowflake,
  application_id: snowflake,
  type: z.number().int(),
  guild_id: snowflake.optional(),
  member: z.object({ user: z.object({ id: snowflake }) }).optional(),
  data: z.unknown().optional(),
});
export function parseDiscordInteraction(
  input: unknown,
  applicationId: string,
): DiscordAction | { kind: 'ping' } {
  const p = payloadSchema.parse(input);
  if (p.application_id !== applicationId)
    throw new GameError(
      'WRONG_APPLICATION',
      'This interaction belongs to another application.',
      401,
    );
  if (p.type === 1) return { kind: 'ping' };
  if (!p.guild_id || !p.member)
    throw new GameError('GUILD_REQUIRED', 'Use this command in a linked Discord server.');
  const context = { id: p.id, guildId: p.guild_id, subject: p.member.user.id };
  if (p.type === 3) {
    const d = z.object({ component_type: z.literal(2), custom_id: z.string() }).parse(p.data);
    const match = /^atlas:open:([a-f0-9-]{36})$/.exec(d.custom_id);
    if (!match) throw new GameError('UNKNOWN_COMMAND', 'This button is not supported.');
    return { ...context, kind: 'confirm', quoteId: z.uuid().parse(match[1]) };
  }
  if (p.type !== 2) throw new GameError('UNKNOWN_COMMAND', 'This interaction is not supported.');
  const data = z
    .object({
      type: z.literal(1),
      // 'atlas' is the command's former name; it keeps working until an
      // operator re-registers commands (which removes the old registration).
      name: z.enum([discordCommandName, legacyDiscordCommandName]),
      options: z
        .array(
          z.object({
            type: z.literal(1),
            name: z.enum(['status', 'packs', 'open', 'collection']),
            options: z.array(z.unknown()).optional(),
          }),
        )
        .length(1),
    })
    .parse(p.data);
  const sub = data.options[0];
  if (sub.name === 'open') {
    if (sub.options?.length !== 1)
      throw new GameError('INVALID_PACK', 'Choose a pack name or ID from /bakufu packs.');
    const pack = z
      .strictObject({
        type: z.literal(3),
        name: z.literal('pack'),
        value: z.string().trim().min(1).max(80),
      })
      .parse(sub.options[0]);
    return { ...context, kind: 'quote', pack: pack.value };
  }
  if (sub.name === 'collection') {
    const options = z
      .array(
        z.discriminatedUnion('name', [
          z.strictObject({
            type: z.literal(4),
            name: z.literal('page'),
            value: z.number().int().min(1).max(1000000),
          }),
          z.strictObject({ type: z.literal(5), name: z.literal('share'), value: z.boolean() }),
        ]),
      )
      .max(2)
      .parse(sub.options ?? []);
    if (new Set(options.map((option) => option.name)).size !== options.length)
      throw new GameError('UNKNOWN_COMMAND', 'This command has duplicate options.');
    return {
      ...context,
      kind: 'collection',
      page: options.find((option) => option.name === 'page')?.value ?? 1,
      share: options.find((option) => option.name === 'share')?.value ?? false,
    };
  }
  if (sub.options?.length)
    throw new GameError('UNKNOWN_COMMAND', 'This command has unexpected options.');
  return { ...context, kind: sub.name };
}
export function discordQuoteId(applicationId: string, interactionId: string) {
  const bytes = createHash('sha256')
    .update(`card-engine:discord:open:${applicationId}:${interactionId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 0x50;
  bytes[8] = (bytes[8] & 63) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function discordText(text: string) {
  return text
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .slice(0, 80)
    .replace(/[\\`*_~|<>@[\]]/g, '\\$&');
}
export type DiscordReply =
  | { type: 1 }
  | {
      type: 4;
      data: {
        content: string;
        flags: 0 | 64;
        allowed_mentions: { parse: [] };
        components?: {
          type: 1;
          components: { type: 2; style: 1; label: string; custom_id: string }[];
        }[];
      };
    };
export function discordMessage(content: string, quoteId?: string, share = false): DiscordReply {
  return {
    type: 4,
    data: {
      content: content.slice(0, 1900),
      flags: share ? 0 : 64,
      allowed_mentions: { parse: [] },
      ...(quoteId
        ? {
            components: [
              {
                type: 1 as const,
                components: [
                  {
                    type: 2 as const,
                    style: 1 as const,
                    label: 'Confirm pack opening',
                    custom_id: `atlas:open:${quoteId}`,
                  },
                ],
              },
            ],
          }
        : {}),
    },
  };
}
export const discordCommandDefinition = {
  name: discordCommandName,
  description: "Play in this server's Bakufu realm",
  type: 1,
  options: [
    { name: 'status', description: 'See your gems, XP, level, and collection size', type: 1 },
    { name: 'packs', description: "List this realm's packs and your current price", type: 1 },
    {
      name: 'collection',
      description: 'List your collected characters in this realm',
      type: 1,
      options: [
        {
          name: 'page',
          description: 'Collection page, ten characters per page',
          type: 4,
          min_value: 1,
          max_value: 1000000,
        },
        {
          name: 'share',
          description: 'Post this collection page publicly in this channel',
          type: 5,
        },
      ],
    },
    {
      name: 'open',
      description: 'Review a pack and confirm before spending gems',
      type: 1,
      options: [
        {
          name: 'pack',
          description: 'Exact pack name or ID from /bakufu packs',
          type: 3,
          required: true,
          min_length: 1,
          max_length: 80,
        },
      ],
    },
  ],
};
