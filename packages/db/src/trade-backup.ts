import { parseRealmConfig } from '../../config/src/index';
import { validateTradePair, type TradeOffer } from '../../core/src/index';
import type { Transaction } from './connection';
export async function validateTradeBackup(tx: Transaction) {
  const trades = (await tx.query('SELECT * FROM trades')).rows,
    versions = (await tx.query('SELECT * FROM trade_versions ORDER BY version')).rows;
  const confirmations = (await tx.query('SELECT * FROM trade_confirmations')).rows,
    reservations = (await tx.query('SELECT * FROM trade_cards')).rows;
  const transfers = (await tx.query('SELECT * FROM card_transfers ORDER BY sequence')).rows,
    cards = (await tx.query('SELECT * FROM cards')).rows;
  const discoveries = (
    await tx.query("SELECT * FROM xp_ledger WHERE reason IN('first_collection','trade_collection')")
  ).rows;
  const ledgers = (await tx.query("SELECT * FROM wallet_ledger WHERE reason='trade'")).rows,
    requests = (await tx.query('SELECT * FROM trade_requests')).rows;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  function check(condition: unknown) {
    if (!condition) throw new Error('Backup trade history does not reconcile.');
  }
  for (const trade of trades) {
    const belongs = (row: { realm_id: string; trade_id: string }) =>
      row.realm_id === trade.realm_id && row.trade_id === trade.id;
    const history = versions.filter(belongs),
      parties = [trade.creator_id, trade.counterparty_id],
      rules = parseRealmConfig(trade.config_snapshot).trading,
      // Protocol 2 (proposals): versions hold both sides and their author confirms them.
      proposals = (trade.protocol ?? 1) === 2;
    check(history.length === trade.offer_version && rules.enabled);
    for (let i = 0; i < history.length; i++) {
      const version = history[i],
        a = version.creator_offer as TradeOffer,
        b = version.counterparty_offer as TradeOffer;
      check(version.version === i + 1 && parties.includes(version.changed_by));
      try {
        validateTradePair(a, b, rules);
      } catch {
        check(false);
      }
      if (i === 0)
        check(
          version.changed_by === trade.creator_id &&
            (proposals || (b.cardIds.length === 0 && b.gems === 0)),
        );
      else if (!proposals)
        check(
          same(
            version.changed_by === trade.creator_id ? b : a,
            version.changed_by === trade.creator_id
              ? history[i - 1].counterparty_offer
              : history[i - 1].creator_offer,
          ),
        );
      const confirmed = confirmations.filter(
        (row) => belongs(row) && row.version === version.version,
      );
      check(confirmed.every((row) => parties.includes(row.account_id)));
      if (proposals) check(confirmed.some((row) => row.account_id === version.changed_by));
      if (i < history.length - 1) check(confirmed.length < 2);
    }
    const current = history[history.length - 1],
      confirmed = confirmations.filter(
        (row) => belongs(row) && row.version === trade.offer_version,
      );
    check(trade.status === 'completed' ? confirmed.length === 2 : confirmed.length < 2);
    const active = reservations.filter((row) => belongs(row) && row.released_at === null);
    for (const [actor, offer] of [
      [trade.creator_id, current.creator_offer],
      [trade.counterparty_id, current.counterparty_offer],
    ] as [string, TradeOffer][])
      check(
        same(
          active
            .filter((row) => row.account_id === actor)
            .map((row) => row.card_id)
            .sort(),
          // Protocol 2 reserves a side only while its owner confirmed this version.
          trade.status === 'pending' &&
            (!proposals || confirmed.some((row) => row.account_id === actor))
            ? [...offer.cardIds].sort()
            : [],
        ),
      );
    for (const reserved of reservations.filter(belongs)) {
      const version = history[reserved.offer_version - 1];
      check(version && parties.includes(reserved.account_id));
      const offer = (
        reserved.account_id === trade.creator_id
          ? version.creator_offer
          : version.counterparty_offer
      ) as TradeOffer;
      check(offer.cardIds.includes(reserved.card_id));
      if (!reserved.released_at) {
        const card = cards.find((c) => c.realm_id === trade.realm_id && c.id === reserved.card_id);
        check(card && card.owner_id === reserved.account_id && !card.recycled_at);
      }
    }
    const moved = transfers.filter(belongs),
      money = ledgers.filter(
        (row) => row.realm_id === trade.realm_id && row.operation_key === `trade:${trade.id}`,
      );
    if (trade.status !== 'completed') {
      check(moved.length === 0 && money.length === 0);
      continue;
    }
    const a = current.creator_offer as TradeOffer,
      b = current.counterparty_offer as TradeOffer;
    check(moved.length === a.cardIds.length + b.cardIds.length && money.length === 2);
    for (const [actor, other, offer, delta] of [
      [trade.creator_id, trade.counterparty_id, a, b.gems - a.gems],
      [trade.counterparty_id, trade.creator_id, b, a.gems - b.gems],
    ] as [string, string, TradeOffer, number][]) {
      check(
        same(
          moved
            .filter((row) => row.from_id === actor && row.to_id === other)
            .map((row) => row.card_id)
            .sort(),
          [...offer.cardIds].sort(),
        ),
      );
      const entry = money.find((row) => row.account_id === actor);
      check(
        entry &&
          entry.amount === delta &&
          entry.created_at.getTime() === trade.completed_at.getTime(),
      );
    }
    check(moved.every((row) => row.created_at.getTime() === trade.completed_at.getTime()));
  }
  check(
    ledgers.every((row) =>
      trades.some(
        (t) =>
          t.realm_id === row.realm_id &&
          row.operation_key === `trade:${t.id}` &&
          t.status === 'completed',
      ),
    ),
  );
  for (const card of cards) {
    const history = transfers.filter(
      (row) => row.realm_id === card.realm_id && row.card_id === card.id,
    );
    let owner = card.original_owner_id;
    for (let i = 0; i < history.length; i++) {
      const move = history[i];
      check(move.sequence === i + 1 && move.from_id === owner);
      owner = move.to_id;
      const seen = discoveries.find(
        (x) =>
          x.realm_id === card.realm_id &&
          x.account_id === owner &&
          x.character_id === card.character_id,
      );
      check(seen && seen.created_at.getTime() <= move.created_at.getTime());
    }
    check(card.owner_id === owner);
  }
  for (const entry of discoveries.filter((row) => row.reason === 'trade_collection')) {
    const move = transfers.find(
      (row) =>
        row.realm_id === entry.realm_id &&
        row.trade_id === entry.trade_id &&
        row.card_id === entry.card_id &&
        row.to_id === entry.account_id,
    );
    const card = cards.find((row) => row.realm_id === entry.realm_id && row.id === entry.card_id);
    check(move && card && card.character_id === entry.character_id && entry.amount === 0);
  }
  for (const request of requests) {
    const trade = trades.find((t) => t.realm_id === request.realm_id && t.id === request.trade_id);
    check(
      trade &&
        [trade.creator_id, trade.counterparty_id].includes(request.account_id) &&
        /^[a-f0-9]{64}$/.test(request.fingerprint),
    );
    check(
      request.result.ok === true &&
        request.result.tradeId === trade.id &&
        Number.isInteger(request.result.version) &&
        request.result.version >= 1 &&
        request.result.version <= trade.offer_version,
    );
    check(['pending', 'completed', 'cancelled', 'expired'].includes(request.result.status));
    if (request.result.status === 'completed')
      check(trade.status === 'completed' && request.result.version === trade.offer_version);
  }
}
