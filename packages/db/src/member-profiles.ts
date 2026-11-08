import { z } from 'zod';
import { transaction, type Database, type Transaction } from './connection';
import { requireMember } from './game';
import { discordAvatarUrlSchema } from '../../config/src/discord-avatar';

const clean = (name: string) =>
  name
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .trim();
const inputName = z.string().max(128).transform(clean).pipe(z.string().min(1).max(64));
const storedName = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => clean(value) === value, 'Profile names must be canonical.');
export const discordNamesSchema = z.strictObject({
  username: inputName,
  displayName: inputName.nullable(),
  avatarUrl: discordAvatarUrlSchema.optional(),
});
export const discordProfileSchema = z.strictObject({
  username: storedName,
  displayName: storedName.nullable(),
  updatedAt: z.iso.datetime(),
  avatarUrl: discordAvatarUrlSchema.optional(),
});
export type DiscordNames = z.infer<typeof discordNamesSchema>;
export type DiscordProfile = z.infer<typeof discordProfileSchema>;
export type RealmMember = {
  tradeCode: string;
  username: string | null;
  displayName: string | null;
  avatarUrl?: string;
};
export type RealmMemberPage = { members: RealmMember[]; nextCursor: string | null };

// Trusted provider boundary only; never expose this as a client profile-write API.
export async function saveDiscordProfile(tx: Transaction, accountId: string, names: DiscordNames) {
  const profile = discordNamesSchema.parse(names);
  await tx.query(
    `INSERT INTO discord_profiles(account_id,username,display_name,avatar_url) VALUES($1,$2,$3,$4)
    ON CONFLICT(account_id) DO UPDATE SET username=EXCLUDED.username,display_name=EXCLUDED.display_name,avatar_url=EXCLUDED.avatar_url,updated_at=clock_timestamp()`,
    [accountId, profile.username, profile.displayName, profile.avatarUrl ?? null],
  );
}
export async function ownDiscordProfile(
  tx: Transaction,
  accountId: string,
): Promise<DiscordProfile | null> {
  const row = (
    await tx.query(
      'SELECT username,display_name AS "displayName",updated_at,to_jsonb(p)->>\'avatar_url\' AS avatar_url FROM discord_profiles p WHERE account_id=$1',
      [accountId],
    )
  ).rows[0];
  return row
    ? discordProfileSchema.parse({
        username: row.username,
        displayName: row.displayName,
        updatedAt: row.updated_at.toISOString(),
        ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}),
      })
    : null;
}
export async function memberProfiles(
  tx: Transaction,
  realmId: string,
  codes: string[],
): Promise<RealmMember[]> {
  return (
    await tx.query(
      `SELECT m.trade_code AS "tradeCode",p.username,p.display_name AS "displayName",to_jsonb(p)->>'avatar_url' AS avatar_url FROM memberships m
    LEFT JOIN discord_profiles p ON p.account_id=m.account_id WHERE m.realm_id=$1 AND m.trade_code=ANY($2::uuid[]) ORDER BY m.trade_code`,
      [realmId, codes],
    )
  ).rows.map(({ avatar_url, ...row }) => ({
    ...row,
    ...(avatar_url ? { avatarUrl: avatar_url } : {}),
  }));
}
const lookupSchema = z.strictObject({
  query: z
    .string()
    .trim()
    .max(80)
    .transform((value) => value.normalize('NFC'))
    .default(''),
  cursor: z.uuid().optional(),
  limit: z.number().int().min(1).max(20).default(20),
});
export async function listRealmMembers(
  db: Database,
  actorId: string,
  realmId: string,
  input: unknown = {},
): Promise<RealmMemberPage> {
  z.uuid().parse(actorId);
  z.uuid().parse(realmId);
  const options = lookupSchema.parse(input);
  return transaction(
    db,
    async (tx) => {
      await requireMember(tx, realmId, actorId);
      const rows = (
        await tx.query(
          `SELECT m.trade_code AS "tradeCode",p.username,p.display_name AS "displayName",to_jsonb(p)->>'avatar_url' AS avatar_url FROM memberships m
      LEFT JOIN discord_profiles p ON p.account_id=m.account_id
      WHERE m.realm_id=$1 AND m.account_id!=$2 AND ($3::uuid IS NULL OR m.trade_code>$3)
        AND ($4='' OR strpos(lower(COALESCE(p.username,'')),lower($4))>0 OR strpos(lower(COALESCE(p.display_name,'')),lower($4))>0 OR m.trade_code::text=$4)
      ORDER BY m.trade_code LIMIT $5`,
          [realmId, actorId, options.cursor ?? null, options.query, options.limit + 1],
        )
      ).rows.map(({ avatar_url, ...row }) => ({
        ...row,
        ...(avatar_url ? { avatarUrl: avatar_url } : {}),
      })) as RealmMember[];
      return {
        members: rows.slice(0, options.limit),
        nextCursor: rows.length > options.limit ? rows[options.limit - 1].tradeCode : null,
      };
    },
    true,
  );
}
