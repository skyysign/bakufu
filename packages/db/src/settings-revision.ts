import { GameError } from '../../core/src/index';
import type { Transaction } from './connection';

// Trusted service callers can act on current rules. HTTP commands always supply
// a revision (0 for an older/malformed page); receipts replay before this check.
export async function requireExpectedRevision(tx: Transaction, realmId: string, expected?: number) {
  if (expected === undefined) return;
  const actual = (await tx.query('SELECT config_revision FROM realms WHERE id=$1', [realmId]))
    .rows[0].config_revision;
  if (!Number.isInteger(expected) || expected !== actual)
    throw new GameError(
      'SETTINGS_CHANGED',
      'Realm settings changed or this page is out of date. Refresh before trying again.',
      409,
    );
}
