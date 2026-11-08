import { createHash } from 'node:crypto';
import { marketCommandSchema } from './market';
import type { Transaction } from './connection';

// Supplements the existing complete trade/ownership/wallet restore audit.
export async function validateMarketBackup(tx: Transaction) {
  const listings = (await tx.query('SELECT * FROM market_listings')).rows;
  const requests = (await tx.query('SELECT * FROM market_requests')).rows;
  const cards = (await tx.query('SELECT * FROM cards')).rows;
  const trades = (await tx.query('SELECT * FROM trades')).rows;
  const versions = (await tx.query('SELECT * FROM trade_versions')).rows;
  const reservations = (await tx.query('SELECT * FROM trade_cards WHERE released_at IS NULL')).rows;
  const ledger = (await tx.query("SELECT * FROM wallet_ledger WHERE reason='trade'")).rows;
  function check(condition: unknown) {
    if (!condition) throw new Error('Backup market history does not reconcile.');
  }
  for (const listing of listings) {
    const card = cards.find(
      (row) => row.realm_id === listing.realm_id && row.id === listing.card_id,
    );
    check(card);
    if (listing.status === 'active') {
      check(card.owner_id === listing.seller_id && card.recycled_at === null);
      check(
        !reservations.some(
          (row) => row.realm_id === listing.realm_id && row.card_id === listing.card_id,
        ),
      );
    }
    if (listing.status === 'sold') {
      const trade = trades.find(
        (row) => row.realm_id === listing.realm_id && row.id === listing.sale_trade_id,
      );
      const final = versions.find(
        (row) =>
          row.realm_id === listing.realm_id &&
          row.trade_id === listing.sale_trade_id &&
          row.version === 2,
      );
      check(
        trade &&
          trade.status === 'completed' &&
          trade.offer_version === 2 &&
          trade.creator_id === listing.seller_id &&
          trade.counterparty_id === listing.buyer_id,
      );
      check(trade.completed_at.getTime() === listing.closed_at.getTime());
      check(
        final && final.creator_offer.gems === 0 && final.counterparty_offer.gems === listing.price,
      );
      check(
        final.creator_offer.cardIds.length === 1 &&
          final.creator_offer.cardIds[0] === listing.card_id &&
          final.counterparty_offer.cardIds.length === 0,
      );
    }
    const history = requests.filter(
      (row) => row.realm_id === listing.realm_id && row.listing_id === listing.id,
    );
    const creation = history.filter((row) => row.command.action === 'list');
    check(
      creation.length === 1 &&
        creation[0].account_id === listing.seller_id &&
        creation[0].created_at.getTime() === listing.created_at.getTime(),
    );
    const terminal = history.filter((row) => row.command.action !== 'list');
    check(terminal.length === (listing.status === 'active' ? 0 : 1));
    if (terminal.length) check(terminal[0].created_at.getTime() === listing.closed_at.getTime());
  }
  for (const request of requests) {
    const listing = listings.find(
      (row) => row.realm_id === request.realm_id && row.id === request.listing_id,
    );
    const command = marketCommandSchema.parse(request.command);
    const fingerprint = createHash('sha256').update(JSON.stringify(command)).digest('hex');
    check(request.fingerprint === fingerprint && listing);
    check(
      request.result.ok === true &&
        request.result.listingId === listing.id &&
        request.result.cardId === listing.card_id &&
        request.result.price === listing.price,
    );
    check(Number.isInteger(request.result.balance) && request.result.balance >= 0);
    if (command.action === 'list') {
      check(
        request.account_id === listing.seller_id &&
          command.cardId === listing.card_id &&
          command.price === listing.price,
      );
      check(request.result.status === 'active' && request.result.tradeId === null);
    } else {
      check(command.listingId === listing.id);
      if (command.action === 'buy') {
        check(
          request.account_id === listing.buyer_id &&
            listing.status === 'sold' &&
            request.result.status === 'sold' &&
            request.result.tradeId === listing.sale_trade_id,
        );
        const debit = ledger.find(
          (row) =>
            row.realm_id === listing.realm_id &&
            row.account_id === listing.buyer_id &&
            row.operation_key === `trade:${listing.sale_trade_id}`,
        );
        check(
          debit &&
            debit.balance_after === request.result.balance &&
            debit.amount === -listing.price,
        );
      } else
        check(
          request.account_id === listing.seller_id &&
            listing.status === 'cancelled' &&
            request.result.status === 'cancelled' &&
            request.result.tradeId === null,
        );
    }
  }
}
