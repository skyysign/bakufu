import type { CSSProperties } from 'react';
import type { Tier } from '@card-engine/config';

/**
 * The tier-specific effect layer of a card reveal (foil sweep, crossing orbits,
 * summoning circle, ascension gate). Shared by the pack reveal and the card
 * inspector, so inspecting a card replays the moment it was revealed.
 * Decorative only; reduced motion hides it in CSS.
 */
export function RarityEffects({ tier }: { tier: Tier }) {
  return (
    <div className={`rarity-effects effect-${tier}`} aria-hidden="true">
      {(tier === 'epic' || tier === 'legendary') && (
        <>
          <span className="ascension-gate" />
          <span className="ascension-wing wing-left" />
          <span className="ascension-wing wing-right" />
          {tier === 'legendary' && <span className="legendary-crown" />}
          {Array.from({ length: tier === 'legendary' ? 18 : 10 }, (_, ray) => (
            <span key={ray} className="ascension-ray" style={{ '--ray': ray } as CSSProperties} />
          ))}
        </>
      )}
      {tier === 'common' ? (
        <span className="foil-sweep" />
      ) : tier === 'uncommon' ? (
        <>
          <span className="discovery-orbit orbit-near" />
          <span className="discovery-orbit orbit-far" />
          {Array.from({ length: 6 }, (_, shard) => (
            <span
              className="discovery-shard"
              key={shard}
              style={{ '--shard': shard } as CSSProperties}
            />
          ))}
        </>
      ) : (
        <>
          <span className="summoning-circle circle-outer" />
          <span className="summoning-circle circle-inner" />
          <span className="summoning-column" />
          {Array.from({ length: 12 }, (_, star) => (
            <span
              className="summoning-star"
              key={star}
              style={{ '--star': star } as CSSProperties}
            />
          ))}
        </>
      )}
    </div>
  );
}
