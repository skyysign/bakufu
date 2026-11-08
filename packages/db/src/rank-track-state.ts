import type { RealmConfig } from '../../config/src/index';
import { applyRankBenefits } from '../../core/src/ranks';
import { applyRankTrackBenefits, type RankTrackLevels } from '../../core/src/rank-tracks';
import type { Transaction } from './connection';
import { purchasedCollectorRank } from './rank-state';

// Internal only: caller authorizes membership in the same transaction.
export async function purchasedRankTrackLevels(
  tx: Transaction,
  realmId: string,
  accountId: string,
): Promise<RankTrackLevels> {
  const exists = (
    await tx.query("SELECT to_regclass('rank_track_purchases') IS NOT NULL AS present")
  ).rows[0].present;
  if (!exists) return {};
  return Object.fromEntries(
    (
      await tx.query(
        'SELECT track_id,max(level)::integer AS level FROM rank_track_purchases WHERE realm_id=$1 AND account_id=$2 GROUP BY track_id ORDER BY track_id',
        [realmId, accountId],
      )
    ).rows.map((row) => [row.track_id, row.level]),
  );
}
export async function effectiveMemberConfig(
  tx: Transaction,
  realmId: string,
  accountId: string,
  config: RealmConfig,
  legacyRank?: number,
): Promise<RealmConfig> {
  const rank = legacyRank ?? (await purchasedCollectorRank(tx, realmId, accountId));
  return applyRankTrackBenefits(
    applyRankBenefits(config, rank),
    await purchasedRankTrackLevels(tx, realmId, accountId),
  );
}
