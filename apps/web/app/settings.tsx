'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { CollectorRankFields, readCollectorRanks } from './collector-ranks';
import { RulesCategoryTabs, RulesFields, readRules, type RulesCategory } from './rules-fields';
import { realmConfigSchema, tiers } from '@card-engine/config';
import type { ClientRealmView as RealmView } from '../lib/client-view';
import type { SettingsPreview, SettingsResult } from '@card-engine/core';

class SettingsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
async function request(path: string, input: unknown) {
  const response = await fetch(`/api/settings/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const result = await response.json();
  if (!response.ok)
    throw new SettingsError(result.error ?? 'The settings request failed.', response.status);
  return result;
}
function NumberField({
  name,
  label,
  value,
  min = 0,
  max = 1_000_000,
}: {
  name: string;
  label: string;
  value: number;
  min?: number;
  max?: number;
}) {
  return (
    <div>
      <label htmlFor={`settings-${name}`}>{label}</label>
      <input
        id={`settings-${name}`}
        name={name}
        type="number"
        min={min}
        max={max}
        step={1}
        defaultValue={value}
        required
      />
    </div>
  );
}
export function RealmSettings({
  view,
  onSaved,
  onClose,
  onLockChange,
}: {
  view: RealmView;
  onSaved: (result: SettingsResult) => void;
  onClose?: () => void;
  onLockChange: (locked: boolean) => void;
}) {
  const [preview, setPreview] = useState<SettingsPreview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [rankCount, setRankCount] = useState(view.config.upgrades.packDiscount.length);
  const [pending, setPending] = useState<{ previewId: string; key: string } | null>(null);
  useEffect(() => {
    onLockChange(busy || !!pending);
  }, [busy, pending, onLockChange]);
  useEffect(() => () => onLockChange(false), [onLockChange]);
  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || pending) return;
    const form = new FormData(event.currentTarget),
      number = (key: string) => Number(form.get(key));
    setError('');
    setPreview(null);
    setBusy(true);
    try {
      const parsed = realmConfigSchema.safeParse({
        ...view.config,
        ...readRules(form),
        ranks: view.config.legacyPurchasesRetired ? view.config.ranks : readCollectorRanks(form),
        upgrades: view.config.legacyPurchasesRetired
          ? view.config.upgrades
          : {
              packDiscount: Array.from({ length: rankCount }, (_, index) => ({
                cost: number(`cost-${index}`),
                requiredLevel: number(`level-${index}`),
                discount: number(`discount-${index}`),
              })),
            },
      });
      if (!parsed.success)
        throw new Error(
          'Check the settings: use whole numbers, increasing level thresholds starting at 0, increasing rank discounts, and at least one positive rarity weight.',
        );
      setPreview(
        (await request('preview', { realmId: view.id, config: parsed.data })) as SettingsPreview,
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (busy || !preview) return;
    const attempt = pending ?? { previewId: preview.id, key: crypto.randomUUID() };
    setPending(attempt);
    setBusy(true);
    setError('');
    try {
      const result = (await request('apply', {
        realmId: view.id,
        previewId: attempt.previewId,
        requestKey: attempt.key,
      })) as SettingsResult;
      setPending(null);
      onSaved(result);
    } catch (error) {
      setError((error as Error).message);
      if (error instanceof SettingsError && error.status < 500) {
        setPending(null);
        setPreview(null);
      }
    } finally {
      setBusy(false);
    }
  }
  const [category, setCategory] = useState<RulesCategory>('economy');
  const config = view.config;
  return (
    <section className="panel settings-panel" aria-label="Game rules">
      <div className="section-heading">
        <div>
          <h2>Game rules</h2>
          <p className="section-intro">
            Change a value, then select <strong>Preview settings changes</strong>. You’ll see what
            changes and who is affected before anything is saved. Cards, balances and receipts are
            never rewritten.
          </p>
        </div>
        {onClose && (
          <button type="button" className="secondary" disabled={busy || !!pending} onClick={onClose}>
            Back to overview
          </button>
        )}
      </div>
      <RulesCategoryTabs value={category} onChange={setCategory} label="Settings categories" />
      <form
        onSubmit={review}
        onInvalidCapture={(event) => {
          const field = event.target;
          if (
            !(
              field instanceof HTMLInputElement ||
              field instanceof HTMLSelectElement ||
              field instanceof HTMLTextAreaElement
            )
          )
            return;
          event.preventDefault();
          const section = field.closest<HTMLElement>('[data-category]')?.dataset.category;
          if (section) setCategory(section as RulesCategory);
          const details = field.closest('details');
          if (details) details.open = true;
          setError(field.validationMessage);
          requestAnimationFrame(() => field.focus());
        }}
        onChange={() => {
          setPreview(null);
          setError('');
        }}
      >
        <fieldset disabled={busy || !!pending} className="settings-fields" data-category={category}>
          <RulesFields
            config={config}
            prefix="settings"
            ownedRankLevels={view.ownedRankTrackLevels ?? undefined}
            onChanged={() => {
              setPreview(null);
              setError('');
            }}
          />
          {!config.legacyPurchasesRetired && (
            <div data-category="ranks">
              <CollectorRankFields
                value={config.ranks}
                prefix="settings"
                onChanged={() => {
                  setPreview(null);
                  setError('');
                }}
              />
            </div>
          )}
          {!config.legacyPurchasesRetired && (
            <fieldset className="reward-settings" data-category="progression">
              <legend>Pack discount upgrades</legend>
              <label htmlFor="settings-rankCount">Pack discount ranks</label>
              <select
                id="settings-rankCount"
                value={rankCount}
                onChange={(event) => setRankCount(Number(event.target.value))}
              >
                {Array.from({ length: 6 }, (_, rank) => (
                  <option key={rank} value={rank}>
                    {rank === 0 ? 'Disabled' : `${rank} rank${rank === 1 ? '' : 's'}`}
                  </option>
                ))}
              </select>
              <p className="small quiet">
                Ranks already purchased in this realm must keep their costs, requirements, and
                discounts. New or unpurchased ranks may change.
              </p>
              {Array.from({ length: rankCount }, (_, index) => {
                const rule = config.upgrades.packDiscount[index] ?? {
                  cost: (index + 1) * 10,
                  requiredLevel: index + 2,
                  discount: index + 1,
                };
                return (
                  <fieldset className="upgrade-rank-fields" key={index}>
                    <legend>Rank {index + 1}</legend>
                    <div className="reward-fields">
                      <NumberField
                        name={`cost-${index}`}
                        label={`Rank ${index + 1} cost (gems)`}
                        value={rule.cost}
                      />
                      <NumberField
                        name={`level-${index}`}
                        label={`Rank ${index + 1} required level`}
                        value={rule.requiredLevel}
                        min={1}
                        max={100}
                      />
                      <NumberField
                        name={`discount-${index}`}
                        label={`Rank ${index + 1} discount (gems)`}
                        value={rule.discount}
                        min={1}
                      />
                    </div>
                  </fieldset>
                );
              })}
            </fieldset>
          )}
          <div className="settings-submit">
            <button>{busy ? 'Preparing preview…' : 'Preview settings changes'}</button>
            <span className="setting-help">Nothing is saved until you review the impact.</span>
          </div>
        </fieldset>
      </form>
      <p className="error" role="alert">
        {error}
      </p>
      {preview && (
        <section className="settings-impact" aria-label="Settings impact preview">
          <h3>Review the impact</h3>
          <p className="small quiet">
            This preview expires in five minutes. Gameplay or membership changes require a new
            review.
          </p>
          <div className="table-scroll" tabIndex={0} aria-label="Proposed settings changes">
            <table>
              <thead>
                <tr>
                  <th scope="col">Setting</th>
                  <th scope="col">Current</th>
                  <th scope="col">Proposed</th>
                </tr>
              </thead>
              <tbody>
                {preview.impact.changes.map((change) => (
                  <tr key={change.label}>
                    <th scope="row">{change.label}</th>
                    <td>{change.before}</td>
                    <td>{change.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            {preview.impact.players} players · {preview.impact.levelsUp} would gain levels ·{' '}
            {preview.impact.levelsDown} would display lower levels.
          </p>
          <p>
            {preview.impact.pricesUp} would pay more per pack · {preview.impact.pricesDown} would
            pay less.
          </p>
          <p className="small quiet">
            Players who can afford a pack: {preview.impact.affordableBefore} →{' '}
            {preview.impact.affordableAfter}. Players on cooldown: {preview.impact.waitingBefore} →{' '}
            {preview.impact.waitingAfter}.
          </p>
          <details>
            <summary>Pack availability and rarity odds</summary>
            <div className="table-scroll" tabIndex={0} aria-label="Pack settings impact">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Pack</th>
                    <th scope="col">Eligible cards</th>
                    <th scope="col">Can open after</th>
                    <th scope="col">Rarity odds after</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.impact.packs.map((pack) => (
                    <tr key={pack.id}>
                      <th scope="row">{pack.name}</th>
                      <td>
                        {pack.availableBefore} → {pack.availableAfter}
                      </td>
                      <td>{pack.openableAfter ? 'Yes' : 'No'}</td>
                      <td>
                        {tiers
                          .map((tier) => `${tier} ${(pack.oddsAfter[tier] * 100).toFixed(2)}%`)
                          .join(' · ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          {preview.impact.warnings.length > 0 && (
            <ul className="settings-warnings">
              {preview.impact.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          {preview.impact.blockers.length > 0 && (
            <div role="alert">
              <strong>Resolve before saving</strong>
              <ul>
                {preview.impact.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="recycle-actions">
            <button disabled={busy || preview.impact.blockers.length > 0} onClick={apply}>
              {busy ? 'Saving…' : pending ? 'Retry settings save' : 'Apply reviewed settings'}
            </button>
            <button
              className="secondary"
              disabled={busy || !!pending}
              onClick={() => setPreview(null)}
            >
              Discard preview
            </button>
          </div>
        </section>
      )}
    </section>
  );
}
