import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parseRealmConfig } from '../../config/src/index';
import {
  GameError,
  defaultPackName,
  packGroup,
  presentPacks,
  type PackGroup,
} from '../../core/src/index';
import { transaction, type Database, type Transaction } from './connection';
import { requireMember } from './game';

/** Hard ceiling for category packs in one realm (All Characters is extra). */
export const maximumRealmCategoryPacks = 30;

export type RealmPackCandidate = {
  category: string;
  poolSize: number;
  group: PackGroup;
  suggestedName: string;
  packId: string | null;
  packName: string | null;
};
export type RealmPackPlan = {
  packs: { id: string; name: string; category: string | null }[];
  candidates: RealmPackCandidate[];
  catalogSize: number;
  minimumPoolSize: number;
  maximum: number;
};
export type RealmPackAddition = {
  ok: true;
  added: { id: string; name: string; category: string }[];
  alreadyPresent: number;
};

const singleLine = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (value) =>
        Array.from(value).every(
          (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
        ),
      'Use a single-line name.',
    );
const additionSchema = z.strictObject({
  packs: z
    .array(z.strictObject({ category: singleLine(60), name: singleLine(80) }))
    .min(1)
    .max(maximumRealmCategoryPacks),
});

async function requireRealmAdmin(tx: Transaction, actorId: string, realmId: string, lock: boolean) {
  const realm = (
    await tx.query(`SELECT config FROM realms WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [realmId])
  ).rows[0];
  if (!realm) throw new GameError('NOT_FOUND', 'Realm not found.', 404);
  if ((await requireMember(tx, realmId, actorId)).role !== 'admin')
    throw new GameError('FORBIDDEN', 'Only a realm administrator can manage packs.', 403);
  return parseRealmConfig(realm.config);
}
async function categorySizes(tx: Transaction, realmId: string) {
  return (
    await tx.query(
      `SELECT category,count(*)::int AS size FROM characters c, unnest(c.categories) AS category
      WHERE c.realm_id=$1 AND c.retired_at IS NULL GROUP BY category ORDER BY size DESC,category`,
      [realmId],
    )
  ).rows as { category: string; size: number }[];
}

/** Read-only overview of the realm's packs and the catalog categories that could become packs. */
export async function realmPackPlan(
  db: Database,
  actorId: string,
  realmId: string,
): Promise<RealmPackPlan> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  return transaction(
    db,
    async (tx) => {
      const config = await requireRealmAdmin(tx, actorId, realmId, false);
      const packs = presentPacks(
        (
          await tx.query(
            `SELECT id,name,category FROM packs p WHERE realm_id=$1 AND (to_jsonb(p)->>'retired_at') IS NULL ORDER BY category IS NULL,name,id`,
            [realmId],
          )
        ).rows as { id: string; name: string; category: string | null }[],
      );
      const byCategory = new Map(packs.map((pack) => [pack.category, pack]));
      const catalogSize = (
        await tx.query(
          'SELECT count(*)::int AS size FROM characters WHERE realm_id=$1 AND retired_at IS NULL',
          [realmId],
        )
      ).rows[0].size as number;
      return {
        packs,
        candidates: (await categorySizes(tx, realmId)).map(({ category, size }) => ({
          category,
          poolSize: size,
          group: packGroup(category),
          suggestedName: defaultPackName(category),
          packId: byCategory.get(category)?.id ?? null,
          packName: byCategory.get(category)?.name ?? null,
        })),
        catalogSize,
        minimumPoolSize: config.minimumPoolSize,
        maximum: maximumRealmCategoryPacks,
      };
    },
    true,
  );
}

/**
 * Adds category packs to an existing realm. New rows only: ownership, saved
 * receipts and existing packs are untouched, and every new pack draws from its
 * exact saved category. Retrying an applied request reports the packs present.
 */
export async function addRealmPacks(
  db: Database,
  actorId: string,
  realmId: string,
  input: unknown,
): Promise<RealmPackAddition> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  const request = additionSchema.parse(input);
  return transaction(db, async (tx) => {
    const config = await requireRealmAdmin(tx, actorId, realmId, true);
    const requestedCategories = request.packs.map((pack) => pack.category);
    const requestedNames = request.packs.map((pack) => pack.name.toLowerCase());
    if (new Set(requestedCategories).size !== requestedCategories.length)
      throw new GameError('PACK_PLAN_INVALID', 'Select each category at most once.');
    if (new Set(requestedNames).size !== requestedNames.length)
      throw new GameError('PACK_PLAN_INVALID', 'Use a different name for every pack.');
    if (requestedNames.includes('all characters'))
      throw new GameError('PACK_PLAN_INVALID', 'All Characters is reserved for the full pack.');
    const all = (
      await tx.query(
        `SELECT id,name,category,(to_jsonb(p)->>'retired_at') IS NOT NULL AS retired FROM packs p WHERE realm_id=$1`,
        [realmId],
      )
    ).rows as { id: string; name: string; category: string | null; retired: boolean }[];
    const saved = all.filter((pack) => !pack.retired);
    const retiredByCategory = new Map(
      all.filter((pack) => pack.retired).map((pack) => [pack.category, pack]),
    );
    const presented = presentPacks(saved);
    const takenNames = new Set([...saved, ...presented].map((pack) => pack.name.toLowerCase()));
    const savedByCategory = new Map(saved.map((pack) => [pack.category, pack]));
    const sizes = new Map(
      (await categorySizes(tx, realmId)).map((row) => [row.category, row.size] as const),
    );
    let alreadyPresent = 0;
    const additions: { name: string; category: string }[] = [];
    for (const pack of request.packs) {
      const existing = savedByCategory.get(pack.category);
      if (existing) {
        const shown = presented.find((entry) => entry.id === existing.id)?.name ?? existing.name;
        if ([existing.name, shown].some((name) => name.toLowerCase() === pack.name.toLowerCase())) {
          alreadyPresent++;
          continue;
        }
        throw new GameError(
          'PACK_EXISTS',
          `${pack.category} already has a pack named ${shown}. Choose another category.`,
          409,
        );
      }
      const size = sizes.get(pack.category);
      if (!size)
        throw new GameError(
          'PACK_PLAN_INVALID',
          `No character in this realm has the category ${pack.category}.`,
        );
      if (size < Math.max(config.minimumPoolSize, config.packSize))
        throw new GameError(
          'PACK_PLAN_INVALID',
          `${pack.category} has too few characters for a pack in this realm.`,
        );
      if (takenNames.has(pack.name.toLowerCase()))
        throw new GameError('PACK_PLAN_INVALID', `A pack named ${pack.name} already exists.`, 409);
      additions.push(pack);
    }
    const categoryPacks = saved.filter((pack) => pack.category !== null).length;
    if (categoryPacks + additions.length > maximumRealmCategoryPacks)
      throw new GameError(
        'PACK_PLAN_INVALID',
        `A realm can have at most ${maximumRealmCategoryPacks} category packs.`,
      );
    const added = [];
    for (const pack of additions) {
      // A removed pack of this category comes back (same ID keeps its history).
      const retired = retiredByCategory.get(pack.category);
      if (retired) {
        await tx.query('UPDATE packs SET retired_at=NULL,name=$3 WHERE realm_id=$1 AND id=$2', [
          realmId,
          retired.id,
          pack.name,
        ]);
        added.push({ id: retired.id, ...pack });
        continue;
      }
      const id = randomUUID();
      await tx.query('INSERT INTO packs(realm_id,id,name,category) VALUES($1,$2,$3,$4)', [
        realmId,
        id,
        pack.name,
        pack.category,
      ]);
      added.push({ id, ...pack });
    }
    return { ok: true, added, alreadyPresent };
  });
}

/**
 * Removes a category pack from play. All Characters cannot be removed. Cards,
 * opening receipts and Discord reviews keep referring to the retired pack.
 */
export async function retireRealmPack(
  db: Database,
  actorId: string,
  realmId: string,
  packId: unknown,
): Promise<{ ok: true; retired: { id: string; name: string } }> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  const id = z.uuid().parse(packId);
  return transaction(db, async (tx) => {
    await requireRealmAdmin(tx, actorId, realmId, true);
    const pack = (
      await tx.query(
        `SELECT id,name,category FROM packs p WHERE realm_id=$1 AND id=$2 AND (to_jsonb(p)->>'retired_at') IS NULL`,
        [realmId, id],
      )
    ).rows[0] as { id: string; name: string; category: string | null } | undefined;
    if (!pack) throw new GameError('NOT_FOUND', 'Pack not found in this realm.', 404);
    if (pack.category === null)
      throw new GameError(
        'PACK_REQUIRED',
        'All Characters is always available and cannot be removed.',
        409,
      );
    await tx.query('UPDATE packs SET retired_at=clock_timestamp() WHERE realm_id=$1 AND id=$2', [
      realmId,
      id,
    ]);
    return { ok: true, retired: { id: pack.id, name: pack.name } };
  });
}
