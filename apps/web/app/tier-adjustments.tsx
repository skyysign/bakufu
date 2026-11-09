'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { TierAdjustmentView, TierFloorPreview } from '@card-engine/db';
import { tiers, type FameFloors, type Tier } from '@card-engine/config';
import { post } from './api-client';

const tierLabel = (tier: string) => tier.charAt(0).toUpperCase() + tier.slice(1);
const floorTiers = ['rare', 'epic', 'legendary'] as const;
type FloorInputs = Record<(typeof floorTiers)[number], string>;
const inputsFor = (floors: FameFloors): FloorInputs => ({
  rare: floors.rare === null ? '' : String(floors.rare),
  epic: floors.epic === null ? '' : String(floors.epic),
  legendary: floors.legendary === null ? '' : String(floors.legendary),
});
const date = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
type Found = { id: string; name: string; series: string; tier: Tier };

function TierChip({ tier }: { tier: Tier }) {
  return (
    <span className="tier-name" data-tier={tier}>
      {tierLabel(tier)}
    </span>
  );
}

/**
 * Administration → Rarity. Fame floors lift well-known provider characters to
 * at least rare/epic/legendary by favourites; a manual tier fixes a single
 * character. Floors are reviewed (every tier change listed) before they apply.
 */
export function RarityAdmin({
  realmId,
  disabled,
  onLockChange,
}: {
  realmId: string;
  disabled: boolean;
  onLockChange: (locked: boolean) => void;
}) {
  const [view, setView] = useState<TierAdjustmentView | null>(null),
    [inputs, setInputs] = useState<FloorInputs>({ rare: '', epic: '', legendary: '' }),
    [preview, setPreview] = useState<TierFloorPreview | null>(null),
    [applyKey, setApplyKey] = useState(''),
    [query, setQuery] = useState(''),
    [found, setFound] = useState<Found[]>([]),
    [chosen, setChosen] = useState<Found | null>(null),
    [manualTier, setManualTier] = useState<string>('auto'),
    [overrideKey, setOverrideKey] = useState(() => crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  useEffect(() => onLockChange(busy || !!preview), [busy, preview, onLockChange]);
  useEffect(() => () => onLockChange(false), [onLockChange]);

  const load = useCallback(async () => {
    const response = await fetch(`/api/tier-adjustments?realmId=${encodeURIComponent(realmId)}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Could not load rarities.');
    setView(body as TierAdjustmentView);
    setInputs(inputsFor((body as TierAdjustmentView).floors));
  }, [realmId]);
  useEffect(() => {
    load().catch((failure) => setError((failure as Error).message));
  }, [load]);

  // Character search for manual tiers (the glossary search, 8 results).
  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setFound([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(
        `/api/catalog?realmId=${encodeURIComponent(realmId)}&query=${encodeURIComponent(text)}&limit=8`,
        { signal: controller.signal },
      )
        .then((response) => response.json())
        .then((body) => setFound((body.characters ?? []) as Found[]))
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, realmId]);

  function floorsFromInputs(): FameFloors {
    const value = (text: string) => {
      const trimmed = text.replace(/[\s,._']/g, '');
      if (!trimmed) return null;
      const number = Number(trimmed);
      if (!Number.isInteger(number) || number < 1)
        throw new Error('Use whole numbers of favourites, or leave a floor empty to turn it off.');
      return number;
    };
    const floors = {
      schemaVersion: 1 as const,
      rare: value(inputs.rare),
      epic: value(inputs.epic),
      legendary: value(inputs.legendary),
    };
    const set = floorTiers.map((tier) => floors[tier]).filter((n): n is number => n !== null);
    if (set.some((n, index) => index > 0 && n <= set[index - 1]))
      throw new Error('Each higher rarity needs more favourites than the one below it.');
    return floors;
  }
  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const result = (await post('tier-adjustments/preview', {
        realmId,
        floors: floorsFromInputs(),
      })) as TierFloorPreview;
      setPreview(result);
      setApplyKey(crypto.randomUUID());
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function applyPreview() {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      const result = await post('tier-adjustments/apply', {
        realmId,
        floors: preview.floors,
        previewHash: preview.previewHash,
        requestKey: applyKey,
      });
      setPreview(null);
      setMessage(
        `Fame floors applied: ${result.changedCharacters.toLocaleString()} characters changed tier.`,
      );
      await load();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveOverride(characterId: string, name: string, tier: Tier | null) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await post('tier-adjustments/override', {
        realmId,
        characterId,
        tier,
        requestKey: overrideKey,
      });
      // A new key only after success: a retry of a lost response is replayed.
      setOverrideKey(crypto.randomUUID());
      setChosen(null);
      setQuery('');
      setMessage(
        tier
          ? `${name} is now ${tierLabel(result.tier)} and stays there.`
          : `${name} follows the automatic tier again (${tierLabel(result.tier)}).`,
      );
      await load();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const locked = disabled || busy;
  const recommended = view?.recommended;

  return (
    <section className="panel rarity-admin" aria-labelledby="rarity-admin-title">
      <h2 id="rarity-admin-title">Rarity</h2>
      <p className="section-intro">
        Tiers come from each character&apos;s standing in this realm&apos;s own roster, so in a
        realm of hit series a famous character can still land low. Fame floors make well-known
        characters at least rare, epic or legendary based on their MyAnimeList or AniList
        favourites. You can also set a single character&apos;s tier by hand.
      </p>
      {message && (
        <p className="success-note" role="status">
          {message}
        </p>
      )}
      <p className="error" role="alert">
        {error}
      </p>
      {!view ? (
        !error && <p role="status">Loading rarities…</p>
      ) : (
        <>
          <dl className="admin-stats rarity-counts" aria-label="Characters per rarity">
            {tiers.map((tier) => (
              <div key={tier}>
                <dt>{tierLabel(tier)}</dt>
                <dd>{view.counts[tier].toLocaleString()}</dd>
              </div>
            ))}
          </dl>

          <form className="artwork-backfill rarity-floors" onSubmit={review}>
            <h3>Fame floors</h3>
            {view.providerCharacters === 0 ? (
              <p className="field-help">
                This realm&apos;s characters come from your own catalog. Floors only apply to
                MyAnimeList and AniList characters, whose favourites share one scale.
              </p>
            ) : (
              <p className="field-help">
                Minimum favourites for each rarity. Leave a field empty to turn that floor off.
                {view.raisedByFloors > 0 &&
                  ` ${view.raisedByFloors.toLocaleString()} characters are currently lifted by floors.`}
              </p>
            )}
            <div className="rarity-floor-fields">
              {floorTiers.map((tier) => (
                <label key={tier}>
                  {tierLabel(tier)} from
                  <input
                    inputMode="numeric"
                    value={inputs[tier]}
                    placeholder="Off"
                    disabled={locked || !!preview}
                    aria-describedby="rarity-floor-unit"
                    onChange={(event) => setInputs({ ...inputs, [tier]: event.target.value })}
                  />
                </label>
              ))}
            </div>
            <p id="rarity-floor-unit" className="field-help">
              Favourites on the source site
              {recommended &&
                `. Recommended: ${floorTiers
                  .map((tier) => `${tierLabel(tier)} ${recommended[tier]?.toLocaleString()}`)
                  .join(
                    ' · ',
                  )} (calibrated on MyAnimeList; AniList counts run a bit lower for older series).`}
            </p>
            <div className="collection-admin-buttons">
              <button type="submit" disabled={locked || !!preview}>
                {busy && !preview ? 'Reviewing…' : 'Review changes'}
              </button>
              {recommended && (
                <button
                  type="button"
                  className="secondary"
                  disabled={locked || !!preview}
                  onClick={() => setInputs(inputsFor(recommended))}
                >
                  Use recommended
                </button>
              )}
              <button
                type="button"
                className="secondary"
                disabled={locked || !!preview}
                onClick={() => setInputs({ rare: '', epic: '', legendary: '' })}
              >
                Turn all off
              </button>
            </div>
          </form>

          {preview && (
            <section
              className="artwork-backfill rarity-preview"
              aria-labelledby="rarity-preview-title"
            >
              <h3 id="rarity-preview-title">Review</h3>
              {preview.changedCharacters === 0 ? (
                <p className="field-help">
                  {preview.floorsChanged
                    ? 'No tier changes. Saving keeps these floors for characters added later.'
                    : 'Nothing changes: these floors are already saved.'}
                </p>
              ) : (
                <p className="field-help">
                  {preview.changedCharacters.toLocaleString()} characters change tier (
                  {preview.raised.toLocaleString()} up, {preview.lowered.toLocaleString()} down).
                  {preview.ownedChanged > 0 &&
                    ` ${preview.ownedChanged.toLocaleString()} of them are in players' collections, so those cards' gem values change too.`}{' '}
                  Cards already pulled keep the tier on their pull receipt; odds and values follow
                  the new tier.
                </p>
              )}
              <table className="rarity-table">
                <caption>Characters per rarity</caption>
                <thead>
                  <tr>
                    <th scope="col">Rarity</th>
                    <th scope="col">Now</th>
                    <th scope="col">After</th>
                  </tr>
                </thead>
                <tbody>
                  {tiers.map((tier) => (
                    <tr key={tier}>
                      <th scope="row">{tierLabel(tier)}</th>
                      <td>{preview.before[tier].toLocaleString()}</td>
                      <td>{preview.after[tier].toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.changes.length > 0 && (
                <ul className="sound-rows rarity-changes" aria-label="Tier changes">
                  {preview.changes.map((change) => (
                    <li key={change.characterId} className="sound-row rarity-row">
                      <span className="rarity-move">
                        <TierChip tier={change.before} />
                        <span aria-label="becomes">→</span>
                        <TierChip tier={change.after} />
                      </span>
                      <span className="sound-status">
                        <strong>{change.name}</strong>
                        <small>
                          {change.series}
                          {change.popularity !== null &&
                            ` · ${change.popularity.toLocaleString()} favourites`}
                          {change.owned && ' · owned by a player'}
                        </small>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {preview.changedCharacters > preview.changes.length && (
                <p className="field-help">
                  And {(preview.changedCharacters - preview.changes.length).toLocaleString()} more
                  less favourited characters.
                </p>
              )}
              <div className="collection-admin-buttons">
                <button
                  type="button"
                  disabled={
                    disabled || busy || (preview.changedCharacters === 0 && !preview.floorsChanged)
                  }
                  onClick={() => void applyPreview()}
                >
                  {busy ? 'Applying…' : 'Apply floors'}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setPreview(null)}
                >
                  Cancel
                </button>
              </div>
            </section>
          )}

          <section className="artwork-backfill" aria-labelledby="rarity-manual-title">
            <h3 id="rarity-manual-title">Set a character&apos;s tier by hand</h3>
            <p className="field-help">
              A manual tier stays until you return the character to automatic; fame floors no longer
              move it.
            </p>
            <label className="rarity-search">
              Find a character
              <input
                type="search"
                value={query}
                placeholder="Name or series"
                disabled={locked}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setChosen(null);
                }}
              />
            </label>
            {!chosen && found.length > 0 && (
              <ul className="sound-rows" aria-label="Matching characters">
                {found.map((character) => (
                  <li key={character.id} className="sound-row rarity-row">
                    <TierChip tier={character.tier} />
                    <span className="sound-status">
                      <strong>{character.name}</strong>
                      <small>{character.series}</small>
                    </span>
                    <span className="sound-actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={locked}
                        onClick={() => {
                          setChosen(character);
                          setManualTier(character.tier);
                        }}
                      >
                        Choose
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {chosen && (
              <form
                className="collection-admin-confirm rarity-manual"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveOverride(
                    chosen.id,
                    chosen.name,
                    manualTier === 'auto' ? null : (manualTier as Tier),
                  );
                }}
              >
                <p>
                  <strong>{chosen.name}</strong> · {chosen.series} · now{' '}
                  <TierChip tier={chosen.tier} />
                </p>
                <div className="rarity-manual-field">
                  <label htmlFor="rarity-manual-tier">Tier</label>
                  <select
                    id="rarity-manual-tier"
                    value={manualTier}
                    disabled={locked}
                    onChange={(event) => setManualTier(event.target.value)}
                  >
                    <option value="auto">Automatic (standing and fame floors)</option>
                    {view.drawableTiers.map((tier) => (
                      <option key={tier} value={tier}>
                        {tierLabel(tier)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="collection-admin-buttons">
                  <button type="submit" disabled={locked}>
                    {busy ? 'Saving…' : 'Save tier'}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => setChosen(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
            <h4 className="rarity-subtitle">Manual tiers</h4>
            {view.overrides.length === 0 ? (
              <p className="field-help">No character has a manual tier.</p>
            ) : (
              <ul className="sound-rows" aria-label="Characters with a manual tier">
                {view.overrides.map((character) => (
                  <li key={character.characterId} className="sound-row rarity-row">
                    <TierChip tier={character.tier} />
                    <span className="sound-status">
                      <strong>{character.name}</strong>
                      <small>
                        {character.series} · automatic would be {tierLabel(character.automaticTier)}
                        {character.owned && ' · owned by a player'}
                      </small>
                    </span>
                    <span className="sound-actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={locked}
                        onClick={() =>
                          void saveOverride(character.characterId, character.name, null)
                        }
                      >
                        Back to automatic
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {view.history.length > 0 && (
            <section className="artwork-backfill" aria-labelledby="rarity-history-title">
              <h3 id="rarity-history-title">Recent changes</h3>
              <ul className="sound-rows">
                {view.history.map((entry) => (
                  <li key={entry.id} className="sound-row rarity-row">
                    <span className="sound-status">
                      <strong>
                        {entry.kind === 'floors'
                          ? 'Fame floors applied'
                          : `${entry.characterName ?? 'A character'}: ${
                              entry.override ? `set to ${tierLabel(entry.override)}` : 'automatic'
                            }`}
                      </strong>
                      <small>
                        {date(entry.createdAt)} · {entry.changedCharacters.toLocaleString()} tier
                        {entry.changedCharacters === 1 ? '' : 's'} changed
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </section>
  );
}
