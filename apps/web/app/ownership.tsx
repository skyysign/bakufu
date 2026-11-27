import Link from 'next/link';
import type { CardOwner } from '@card-engine/db';
import { playerName, profileHref } from './player-links';

type Status = 'yours' | 'claimed' | 'available';

/** "In your collection", "Owned by <member>" or "Unclaimed". */
export function ownershipText(status: Status, owner?: CardOwner) {
  if (status === 'yours') return 'In your collection';
  if (status === 'claimed')
    return owner ? `Owned by ${playerName(owner)}` : 'Owned by another collector';
  return 'Unclaimed';
}

/** The ownership line under glossary and wishlist cards; the owner's name opens their profile. */
export function OwnershipStatus({
  realmId,
  status,
  owner,
}: {
  realmId: string;
  status: Status;
  owner?: CardOwner;
}) {
  return (
    <p className={`library-card-status status-${status}`}>
      {status === 'claimed' && owner ? (
        <span>
          Owned by <Link href={profileHref(realmId, owner.tradeCode)}>{playerName(owner)}</Link>
        </span>
      ) : (
        ownershipText(status, owner)
      )}
    </p>
  );
}
