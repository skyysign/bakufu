import { parseRealmConfig } from '../../config/src/index';
import { effectivePackPrice, requirePackOpeningCount } from '../../core/src/index';
import type { OpeningResult } from '../../core/src/index';
import type { Transaction } from './connection';

// New bundle receipts use the existing ownership, XP and wallet journals. Old
// single receipts remain byte-for-byte compatible and retain their old checks.
export async function validatePackBundleBackup(tx: Transaction): Promise<void> {
  const rows = (
    await tx.query(
      `SELECT o.*,p.category,l.amount AS ledger_amount,l.balance_after AS ledger_balance,
      l.reason AS ledger_reason,
      (SELECT jsonb_agg(jsonb_build_object('id',c.id,'characterId',c.character_id))
        FROM cards c WHERE c.realm_id=o.realm_id AND c.original_owner_id=o.account_id AND c.request_key=o.request_key) AS cards
      FROM openings o JOIN packs p ON p.realm_id=o.realm_id AND p.id=o.pack_id
      LEFT JOIN wallet_ledger l ON l.realm_id=o.realm_id AND l.account_id=o.account_id AND l.operation_key=o.request_key::text
      WHERE o.pack_count!=1 OR o.result ? 'packCount'`,
    )
  ).rows;
  for (const row of rows) {
    try {
      const count = requirePackOpeningCount(row.pack_count);
      const result = row.result as OpeningResult;
      if (!result.ok) {
        if (row.ledger_reason || row.cards?.length) throw new Error();
        continue;
      }
      const config = parseRealmConfig(row.config_snapshot),
        price = effectivePackPrice(config, result.packUpgradeRank ?? 0),
        size = count * config.packSize;
      if (
        count === 1 ||
        result.packCount !== count ||
        result.cardsPerPack !== config.packSize ||
        result.unitPrice !== price ||
        result.charged !== price * count ||
        result.openingId !== row.id ||
        result.characters.length !== size ||
        result.cardIds.length !== size ||
        new Set(result.cardIds).size !== size ||
        new Set(result.characters.map((character) => character.id)).size !== size ||
        row.cards?.length !== size ||
        row.ledger_reason !== 'pack_opening' ||
        row.ledger_amount !== -result.charged ||
        row.ledger_balance !== result.balance
      )
        throw new Error();
      const actualCards = new Map<string, string>(
        row.cards.map((card: { id: string; characterId: string }) => [card.id, card.characterId]),
      );
      for (let index = 0; index < size; index++) {
        const character = result.characters[index];
        if (
          actualCards.get(result.cardIds[index]) !== character.id ||
          (row.category !== null && !character.categories.includes(row.category)) ||
          config.tierWeights[character.tier] <= 0
        )
          throw new Error();
      }
    } catch {
      throw new Error('Backup pack bundle receipt, charge or ownership is invalid.');
    }
  }
}
