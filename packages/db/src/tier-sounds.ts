import { z } from 'zod';
import { tiers, type Tier } from '../../config/src/index';
import { GameError } from '../../core/src/index';
import { transaction, type Database, type Transaction } from './connection';
import { requireMember } from './game';

/** Longest custom reveal sound; the browser trims longer uploads before sending. */
export const tierSoundMaxSeconds = 30;
/** Fits 30 s of 16-bit mono PCM at up to 48 kHz (the browser encodes 32 kHz mono)
 * and keeps the base64 text under the table's 4,000,000-character limit. */
export const tierSoundMaxBytes = 2_990_000;
export type TierSoundInfo = { fileName: string; durationMs: number; updatedAt: string };
export type TierSounds = Partial<Record<Tier, TierSoundInfo>>;

const singleLine = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine(
    (value) => Array.from(value).every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127),
    'Use a single-line file name.',
  );
const uploadSchema = z.strictObject({
  tier: z.enum(tiers),
  fileName: singleLine,
  audio: z.string().min(64).max(Math.ceil((tierSoundMaxBytes * 4) / 3) + 4),
  rightsConfirmed: z.literal(true),
});

/**
 * Reads a RIFF/WAVE header and returns its duration. Only uncompressed 16-bit
 * PCM (mono or stereo, 8–48 kHz) is accepted: the browser decodes the admin's
 * file, trims it and encodes this format, so the server never runs a decoder.
 */
export function wavDuration(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.byteLength < 44 || text(0) !== 'RIFF' || text(8) !== 'WAVE')
    throw new GameError('SOUND_INVALID', 'Upload a WAV sound prepared by this page.');
  let offset = 12,
    format: { channels: number; sampleRate: number; bits: number; audio: number } | null = null,
    dataBytes = -1;
  while (offset + 8 <= bytes.byteLength) {
    const id = text(offset),
      size = view.getUint32(offset + 4, true);
    if (id === 'fmt ' && size >= 16 && offset + 24 <= bytes.byteLength)
      format = {
        audio: view.getUint16(offset + 8, true),
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        bits: view.getUint16(offset + 22, true),
      };
    if (id === 'data') {
      dataBytes = Math.min(size, bytes.byteLength - offset - 8);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (
    !format ||
    format.audio !== 1 ||
    format.bits !== 16 ||
    format.channels < 1 ||
    format.channels > 2 ||
    format.sampleRate < 8000 ||
    format.sampleRate > 48000 ||
    dataBytes <= 0
  )
    throw new GameError('SOUND_INVALID', 'Upload a 16-bit PCM WAV sound prepared by this page.');
  const seconds = dataBytes / (format.sampleRate * format.channels * 2);
  if (seconds > tierSoundMaxSeconds + 0.05)
    throw new GameError('SOUND_TOO_LONG', `Sounds can be at most ${tierSoundMaxSeconds} seconds.`);
  return Math.max(1, Math.round(seconds * 1000));
}

async function requireRealmAdmin(tx: Transaction, actorId: string, realmId: string) {
  const realm = (await tx.query('SELECT id FROM realms WHERE id=$1 FOR UPDATE', [realmId])).rows[0];
  if (!realm) throw new GameError('NOT_FOUND', 'Realm not found.', 404);
  if ((await requireMember(tx, realmId, actorId)).role !== 'admin')
    throw new GameError('FORBIDDEN', 'Only a realm administrator can change reveal sounds.', 403);
}

/** Which tiers have a custom sound (no audio bytes); part of the realm view. */
export async function tierSoundsForRealm(tx: Transaction, realmId: string): Promise<TierSounds> {
  const exists = (await tx.query("SELECT to_regclass('realm_tier_sounds') IS NOT NULL AS present"))
    .rows[0].present as boolean;
  if (!exists) return {};
  const rows = (
    await tx.query(
      'SELECT tier,file_name,duration_ms,updated_at FROM realm_tier_sounds WHERE realm_id=$1',
      [realmId],
    )
  ).rows;
  return Object.fromEntries(
    rows.map((row) => [
      row.tier,
      {
        fileName: row.file_name,
        durationMs: row.duration_ms,
        updatedAt: (row.updated_at as Date).toISOString(),
      },
    ]),
  );
}

export async function setTierSound(
  db: Database,
  actorId: string,
  realmId: string,
  input: unknown,
): Promise<TierSounds> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  const upload = uploadSchema.parse(input);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(upload.audio))
    throw new GameError('SOUND_INVALID', 'The sound upload is not valid base64 data.');
  const bytes = Buffer.from(upload.audio, 'base64');
  if (bytes.byteLength > tierSoundMaxBytes)
    throw new GameError('SOUND_TOO_LARGE', 'The prepared sound is too large.');
  const durationMs = wavDuration(bytes);
  return transaction(db, async (tx) => {
    await requireRealmAdmin(tx, actorId, realmId);
    await tx.query(
      `INSERT INTO realm_tier_sounds(realm_id,tier,file_name,duration_ms,audio,rights_confirmed,updated_by,updated_at)
      VALUES($1,$2,$3,$4,$5,true,$6,clock_timestamp())
      ON CONFLICT(realm_id,tier) DO UPDATE SET file_name=excluded.file_name,duration_ms=excluded.duration_ms,
      audio=excluded.audio,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
      [realmId, upload.tier, upload.fileName, durationMs, bytes.toString('base64'), actorId],
    );
    return tierSoundsForRealm(tx, realmId);
  });
}

export async function removeTierSound(
  db: Database,
  actorId: string,
  realmId: string,
  tier: unknown,
): Promise<TierSounds> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  const parsed = z.enum(tiers).parse(tier);
  return transaction(db, async (tx) => {
    await requireRealmAdmin(tx, actorId, realmId);
    await tx.query('DELETE FROM realm_tier_sounds WHERE realm_id=$1 AND tier=$2', [
      realmId,
      parsed,
    ]);
    return tierSoundsForRealm(tx, realmId);
  });
}

/** Audio bytes for members of the realm. */
export async function readTierSound(
  db: Database,
  actorId: string,
  realmId: string,
  tier: unknown,
): Promise<{ audio: Buffer; updatedAt: string } | null> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  const parsed = z.enum(tiers).parse(tier);
  return transaction(
    db,
    async (tx) => {
      await requireMember(tx, realmId, actorId);
      const row = (
        await tx.query('SELECT audio,updated_at FROM realm_tier_sounds WHERE realm_id=$1 AND tier=$2', [
          realmId,
          parsed,
        ])
      ).rows[0];
      return row
        ? { audio: Buffer.from(row.audio, 'base64'), updatedAt: (row.updated_at as Date).toISOString() }
        : null;
    },
    true,
  );
}

export type CharacterSoundInfo = TierSoundInfo & { name: string; series: string; tier: Tier };
export type CharacterSounds = Record<string, CharacterSoundInfo>;
const characterUploadSchema = z.strictObject({
  characterId: z.uuid(),
  fileName: singleLine,
  audio: uploadSchema.shape.audio,
  rightsConfirmed: z.literal(true),
});

/** Characters with their own reveal sound (no audio bytes); part of the realm view. */
export async function characterSoundsForRealm(
  tx: Transaction,
  realmId: string,
): Promise<CharacterSounds> {
  const exists = (
    await tx.query("SELECT to_regclass('realm_character_sounds') IS NOT NULL AS present")
  ).rows[0].present as boolean;
  if (!exists) return {};
  const rows = (
    await tx.query(
      `SELECT s.character_id,s.file_name,s.duration_ms,s.updated_at,c.name,c.series,c.tier
      FROM realm_character_sounds s JOIN characters c ON c.realm_id=s.realm_id AND c.id=s.character_id
      WHERE s.realm_id=$1 ORDER BY c.name,c.id`,
      [realmId],
    )
  ).rows;
  return Object.fromEntries(
    rows.map((row) => [
      row.character_id,
      {
        fileName: row.file_name,
        durationMs: row.duration_ms,
        updatedAt: (row.updated_at as Date).toISOString(),
        name: row.name,
        series: row.series,
        tier: row.tier,
      },
    ]),
  );
}

function decodeUpload(audio: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(audio))
    throw new GameError('SOUND_INVALID', 'The sound upload is not valid base64 data.');
  const bytes = Buffer.from(audio, 'base64');
  if (bytes.byteLength > tierSoundMaxBytes)
    throw new GameError('SOUND_TOO_LARGE', 'The prepared sound is too large.');
  return { bytes, durationMs: wavDuration(bytes) };
}

/** A character's own reveal sound; it takes priority over the rarity sound. */
export async function setCharacterSound(
  db: Database,
  actorId: string,
  realmId: string,
  input: unknown,
): Promise<CharacterSounds> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  const upload = characterUploadSchema.parse(input);
  const { bytes, durationMs } = decodeUpload(upload.audio);
  return transaction(db, async (tx) => {
    await requireRealmAdmin(tx, actorId, realmId);
    const character = (
      await tx.query('SELECT 1 FROM characters WHERE realm_id=$1 AND id=$2', [realmId, upload.characterId])
    ).rowCount;
    if (!character) throw new GameError('NOT_FOUND', 'That character is not in this realm.', 404);
    await tx.query(
      `INSERT INTO realm_character_sounds(realm_id,character_id,file_name,duration_ms,audio,rights_confirmed,updated_by,updated_at)
      VALUES($1,$2,$3,$4,$5,true,$6,clock_timestamp())
      ON CONFLICT(realm_id,character_id) DO UPDATE SET file_name=excluded.file_name,duration_ms=excluded.duration_ms,
      audio=excluded.audio,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
      [realmId, upload.characterId, upload.fileName, durationMs, bytes.toString('base64'), actorId],
    );
    return characterSoundsForRealm(tx, realmId);
  });
}

export async function removeCharacterSound(
  db: Database,
  actorId: string,
  realmId: string,
  characterId: unknown,
): Promise<CharacterSounds> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  const id = z.uuid().parse(characterId);
  return transaction(db, async (tx) => {
    await requireRealmAdmin(tx, actorId, realmId);
    await tx.query('DELETE FROM realm_character_sounds WHERE realm_id=$1 AND character_id=$2', [
      realmId,
      id,
    ]);
    return characterSoundsForRealm(tx, realmId);
  });
}

export async function readCharacterSound(
  db: Database,
  actorId: string,
  realmId: string,
  characterId: unknown,
): Promise<{ audio: Buffer; updatedAt: string } | null> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  const id = z.uuid().parse(characterId);
  return transaction(
    db,
    async (tx) => {
      await requireMember(tx, realmId, actorId);
      const row = (
        await tx.query(
          'SELECT audio,updated_at FROM realm_character_sounds WHERE realm_id=$1 AND character_id=$2',
          [realmId, id],
        )
      ).rows[0];
      return row
        ? { audio: Buffer.from(row.audio, 'base64'), updatedAt: (row.updated_at as Date).toISOString() }
        : null;
    },
    true,
  );
}
