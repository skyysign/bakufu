'use client';
import { useEffect, useState, type FormEvent } from 'react';
import type { CatalogPreview } from '@card-engine/db';
import { defaultConfig, realmConfigSchema, type StarterPackPlan } from '@card-engine/config';
import { ApiError, post } from './api-client';
import { screenHref } from './screens';
import { GameIcon } from './game-art';
import {
  CatalogFields,
  CatalogReview,
  catalogSourceLabel,
  initialCatalogSelection,
  type CatalogSelection,
} from './catalog-fields';
import { StarterPackFields } from './starter-pack-fields';
import { RulesCategoryTabs, RulesFields, readRules, type RulesCategory } from './rules-fields';

const steps = [
  { id: 'basics', title: 'Name', hint: 'What players see' },
  { id: 'characters', title: 'Characters', hint: 'Who can be pulled' },
  { id: 'packs', title: 'Packs', hint: 'How they are grouped' },
  { id: 'rules', title: 'Rules', hint: 'Gems and rewards' },
  { id: 'review', title: 'Review', hint: 'Create the realm' },
] as const;
export type CreateStep = (typeof steps)[number]['id'];

function hours(seconds: number) {
  const value = seconds / 3600;
  return `${Number.isInteger(value) ? value : value.toFixed(1)} h`;
}

/**
 * Guided realm creation. Every step stays mounted (only hidden), so one form
 * submission still carries all settings; the server preview must match the
 * exact proposal before creation, and a failed creation can be retried safely.
 */
export function CreateRealmWizard({
  onLockChange,
}: {
  onLockChange: (locked: boolean) => void;
}) {
  const [step, setStep] = useState<CreateStep>('basics'),
    [visited, setVisited] = useState<Set<CreateStep>>(() => new Set(['basics'])),
    [realmName, setRealmName] = useState(''),
    [busy, setBusy] = useState<'preview' | 'create' | null>(null),
    [error, setError] = useState(''),
    [rulesCustomized, setRulesCustomized] = useState(false),
    [rulesCategory, setRulesCategory] = useState<RulesCategory>('economy');
  const [pendingCreation, setPendingCreation] = useState<Record<string, unknown> | null>(null);
  const [catalogSelection, setCatalogSelection] =
    useState<CatalogSelection>(initialCatalogSelection);
  const [catalogPreview, setCatalogPreview] = useState<CatalogPreview | null>(null);
  const [packOptions, setPackOptions] = useState<CatalogPreview['categoryOptions'] | null>(null);
  const [packPlan, setPackPlan] = useState<StarterPackPlan | undefined>(undefined);
  const [categoryPackLimit, setCategoryPackLimit] = useState(defaultConfig.maximumCategoryPacks);
  useEffect(() => {
    onLockChange(!!busy || !!pendingCreation);
  }, [busy, pendingCreation, onLockChange]);
  useEffect(() => () => onLockChange(false), [onLockChange]);

  const catalogReady =
    !catalogSelection.loading &&
    (!catalogSelection.custom || (!!catalogSelection.data && catalogSelection.rightsConfirmed));
  const index = steps.findIndex((item) => item.id === step);
  function go(next: CreateStep) {
    setStep(next);
    setVisited((current) => new Set(current).add(next));
    setError('');
    document.getElementById('create-realm-title')?.scrollIntoView({ block: 'start' });
  }
  function stepState(id: CreateStep) {
    if (id === step) return 'current';
    const done =
      id === 'basics'
        ? !!realmName.trim()
        : id === 'characters'
          ? catalogReady && visited.has('characters')
          : id === 'packs'
            ? !!catalogPreview
            : id === 'rules'
              ? visited.has('rules')
              : false;
    return done ? 'done' : 'todo';
  }

  function realmProposal(form: FormData) {
    if (
      catalogSelection.custom &&
      (!catalogSelection.data || !catalogSelection.rightsConfirmed || catalogSelection.loading)
    )
      throw new Error('Choose a catalog and confirm your permission to use it.');
    const config = realmConfigSchema.safeParse({
      ...defaultConfig,
      ...readRules(form),
      minimumPoolSize: Number(form.get('minimumPoolSize')),
      maximumCategoryPacks: Number(form.get('maximumCategoryPacks')),
      upgrades: defaultConfig.upgrades,
      ranks: defaultConfig.ranks,
    });
    if (!config.success)
      throw new Error(
        'Check the rules: use whole numbers, level thresholds that increase from 0, and at least one rarity with a positive weight.',
      );
    const proposal = {
      name: form.get('realmName'),
      config: config.data,
      ...(catalogSelection.custom
        ? {
            catalog: {
              data: catalogSelection.data,
              rightsConfirmed: catalogSelection.rightsConfirmed,
              ...(catalogSelection.format === 'csv'
                ? { format: 'csv', metadata: catalogSelection.metadata }
                : {}),
            },
          }
        : {}),
      ...(packPlan === undefined ? {} : { packPlan }),
    };
    if (new TextEncoder().encode(JSON.stringify(proposal)).byteLength > 100 * 1024 * 1024)
      throw new Error(
        'The catalog and its settings exceed the 100 MiB request limit. Choose a smaller roster.',
      );
    return proposal;
  }

  // Hidden steps cannot show browser validation, so open the step that holds
  // the first invalid field and report it there.
  function validate(form: HTMLFormElement) {
    const invalid = form.querySelector<HTMLInputElement>(
      'input:invalid, select:invalid, textarea:invalid',
    );
    if (!invalid) return true;
    const owner = invalid.closest<HTMLElement>('[data-step]')?.dataset.step as
      | CreateStep
      | undefined;
    if (owner && owner !== step) go(owner);
    const category = invalid.closest<HTMLElement>('[data-category]')?.dataset.category;
    if (category) setRulesCategory(category as RulesCategory);
    invalid.closest('details')?.setAttribute('open', '');
    requestAnimationFrame(() => invalid.reportValidity());
    return false;
  }
  async function preview(form: HTMLFormElement) {
    setBusy('preview');
    setError('');
    try {
      const result = (await post(
        'realms/preview',
        realmProposal(new FormData(form)),
      )) as CatalogPreview;
      setCatalogPreview(result);
      setPackOptions(result.categoryOptions);
      return true;
    } catch (failure) {
      setPendingCreation(null);
      setCatalogPreview(null);
      setError((failure as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }
  async function create(form: HTMLFormElement) {
    setBusy('create');
    setError('');
    let attempt = pendingCreation;
    try {
      if (!attempt) {
        attempt = {
          ...realmProposal(new FormData(form)),
          expectedPreview: catalogPreview!.fingerprint,
          requestKey: crypto.randomUUID(),
        };
        setPendingCreation(attempt);
      }
      const result = await post('realms', attempt);
      window.location.assign(screenHref('packs', result.id));
    } catch (failure) {
      if (!attempt || (failure instanceof ApiError && failure.status < 500)) {
        setPendingCreation(null);
        setCatalogPreview(null);
      }
      setError((failure as Error).message);
      setBusy(null);
    }
  }
  const action: 'next' | 'preview' | 'create' = pendingCreation
    ? 'create'
    : step === 'basics'
      ? 'next'
      : step === 'rules'
        ? catalogPreview || !catalogReady
          ? 'next'
          : 'preview'
        : !catalogPreview
          ? 'preview'
          : step === 'review'
            ? 'create'
            : 'next';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (busy || !validate(form)) return;
    if (action === 'next') return go(steps[Math.min(index + 1, steps.length - 1)].id);
    if (action === 'preview') {
      const ok = await preview(form);
      if (ok && step === 'characters') go('packs');
      else if (ok && step === 'rules') go('review');
      return;
    }
    await create(form);
  }
  useEffect(() => {
    if (pendingCreation) setStep('review');
  }, [pendingCreation]);

  const packNames = catalogPreview?.packs.map((pack) => pack.name) ?? [];
  return (
    <section className="wizard panel" aria-labelledby="create-realm-title">
      <header className="wizard-header">
        <h2 id="create-realm-title" tabIndex={-1}>
          Create a realm
        </h2>
        <p>
          A realm is its own game: its own characters, packs, gems and collections. Five short
          steps; nothing is created until you confirm on the last one.
        </p>
      </header>
      <ol className="wizard-steps" aria-label="Realm creation steps">
        {steps.map((item, position) => {
          const state = stepState(item.id);
          return (
            <li key={item.id} data-state={state}>
              <button
                type="button"
                aria-current={item.id === step ? 'step' : undefined}
                onClick={() => go(item.id)}
              >
                <span className="wizard-step-number" aria-hidden="true">
                  {state === 'done' ? <GameIcon name="check" /> : position + 1}
                </span>
                <span className="wizard-step-text">
                  <strong>{item.title}</strong>
                  <small>{item.hint}</small>
                </span>
                {state === 'done' && <span className="sr-only"> (done)</span>}
              </button>
            </li>
          );
        })}
      </ol>
      <form
        className="wizard-form"
        noValidate
        onSubmit={submit}
        onChange={(event) => {
          setCatalogPreview(null);
          if ((event.target as HTMLElement).closest('[data-step="rules"]'))
            setRulesCustomized(true);
        }}
      >
        <fieldset className="create-fields" disabled={!!busy || !!pendingCreation}>
          <div className="wizard-step" data-step="basics" hidden={step !== 'basics'}>
            <h3>Name your realm</h3>
            <p className="step-lede">
              Players see this name in the top bar, on invitations and in Discord. Players in
              different realms never share cards, gems or progress.
            </p>
            <div className="form-field">
              <label htmlFor="realmName">Realm name</label>
              <input
                id="realmName"
                name="realmName"
                maxLength={80}
                required
                placeholder="e.g. Friday Anime Club"
                value={realmName}
                onChange={(event) => setRealmName(event.target.value)}
              />
            </div>
          </div>

          <div className="wizard-step" data-step="characters" hidden={step !== 'characters'}>
            <h3>Choose the characters</h3>
            <p className="step-lede">
              Every card in this realm comes from this list. You can add missing characters
              later under Administration → Characters, but the list can’t be swapped for another.
            </p>
            <CatalogFields
              value={catalogSelection}
              disabled={!!busy}
              onContentChange={() => {
                setPackOptions(null);
                setPackPlan(undefined);
                setCatalogPreview(null);
              }}
              onChange={(value) => {
                setCatalogSelection(value);
                setCatalogPreview(null);
              }}
            />
          </div>

          <div className="wizard-step" data-step="packs" hidden={step !== 'packs'}>
            <h3>Check the packs</h3>
            <p className="step-lede">
              Packs group characters so players can choose what to open. Every realm gets{' '}
              <strong>All Characters</strong>; the others come from your catalog’s categories,
              largest first. Most realms can keep the automatic choice.
            </p>
            {catalogPreview ? (
              <CatalogReview preview={catalogPreview} />
            ) : (
              <div className="wizard-gate">
                <GameIcon name="info" />
                <p>
                  {catalogReady
                    ? 'Preview your characters to see the packs they create and each pack’s odds.'
                    : 'Choose the characters in step 2 first. The packs are generated from them.'}
                </p>
              </div>
            )}
            <StarterPackFields
              options={packOptions}
              value={packPlan}
              maximum={categoryPackLimit}
              onMaximumChange={setCategoryPackLimit}
              onChange={(plan) => {
                setPackPlan(plan);
                setCatalogPreview(null);
              }}
            />
          </div>

          <div className="wizard-step" data-step="rules" hidden={step !== 'rules'}>
            <h3>Set the game rules</h3>
            <p className="step-lede">
              Recommended rules are already filled in. You can change them later under
              Administration → Game rules, where every change is previewed before it applies.
            </p>
            <ul className="rule-summary" aria-label="Recommended defaults">
              <li>
                <span>Pack price</span>
                <strong>{defaultConfig.packPrice.toLocaleString()} gems</strong>
              </li>
              <li>
                <span>Starting gems</span>
                <strong>{defaultConfig.startingGems.toLocaleString()}</strong>
              </li>
              <li>
                <span>Free gems</span>
                <strong>
                  {defaultConfig.gemRewards.enabled
                    ? `${defaultConfig.gemRewards.amount.toLocaleString()} every ${hours(defaultConfig.gemRewards.intervalSeconds)}`
                    : 'Off'}
                </strong>
              </li>
              <li>
                <span>Wishlist</span>
                <strong>
                  {defaultConfig.wishlist.slots} slots · {defaultConfig.wishlist.weightMultiplier}×
                  chance
                </strong>
              </li>
              <li>
                <span>Trading</span>
                <strong>{defaultConfig.trading.enabled ? 'On' : 'Off'}</strong>
              </li>
              <li>
                <span>XP per new character</span>
                <strong>{defaultConfig.progression.xpPerNewCharacter}</strong>
              </li>
            </ul>
            <details className="admin-advanced">
              <summary>Customize gameplay rules</summary>
              <p className="setting-help">
                The same rules as Administration → Game rules. Each change there is previewed before
                it applies.
              </p>
              <RulesCategoryTabs
                value={rulesCategory}
                onChange={setRulesCategory}
                label="Rule categories"
              />
              <div className="settings-fields" data-category={rulesCategory}>
                <RulesFields
                  config={defaultConfig}
                  prefix="create"
                  onChanged={() => {
                    setCatalogPreview(null);
                    setRulesCustomized(true);
                  }}
                />
              </div>
            </details>
          </div>

          <div className="wizard-step" data-step="review" hidden={step !== 'review'}>
            <h3>Review and create</h3>
            <p className="step-lede">Check your choices. Select Edit to change any of them.</p>
            <dl className="wizard-summary">
              <div>
                <dt>Name</dt>
                <dd>{realmName.trim() || 'Not set yet'}</dd>
                <button type="button" className="text-button" onClick={() => go('basics')}>
                  Edit<span className="sr-only"> name</span>
                </button>
              </div>
              <div>
                <dt>Characters</dt>
                <dd>
                  {catalogPreview
                    ? `${catalogPreview.characterCount.toLocaleString()} characters · ${catalogSourceLabel(catalogPreview)}`
                    : catalogReady
                      ? 'Chosen; preview needed'
                      : 'Not chosen yet'}
                </dd>
                <button type="button" className="text-button" onClick={() => go('characters')}>
                  Edit<span className="sr-only"> characters</span>
                </button>
              </div>
              <div>
                <dt>Packs</dt>
                <dd>
                  {catalogPreview
                    ? `${packNames.length} packs: ${packNames.join(', ')}`
                    : 'Shown after the preview'}
                </dd>
                <button type="button" className="text-button" onClick={() => go('packs')}>
                  Edit<span className="sr-only"> packs</span>
                </button>
              </div>
              <div>
                <dt>Rules</dt>
                <dd>{rulesCustomized ? 'Customized' : 'Recommended defaults'}</dd>
                <button type="button" className="text-button" onClick={() => go('rules')}>
                  Edit<span className="sr-only"> rules</span>
                </button>
              </div>
            </dl>
            {!catalogPreview && !pendingCreation && (
              <div className="wizard-gate">
                <GameIcon name="info" />
                <p>
                  {catalogReady
                    ? 'Your latest changes need a fresh preview before the realm can be created.'
                    : 'Choose the characters in step 2 before creating the realm.'}
                </p>
              </div>
            )}
            <div className="wizard-next">
              <h4>After you create it</h4>
              <ol>
                <li>You land on the realm’s Packs page and can open packs right away.</li>
                <li>
                  In Administration → Players &amp; access, link your Discord server, choose who can
                  join and invite players.
                </li>
              </ol>
            </div>
          </div>
        </fieldset>
        {pendingCreation && (
          <p className="notice" role="status">
            Recover this creation before editing the proposal. Retrying will return its original
            realm.
          </p>
        )}
        <p className="error" role="alert">
          {error}
        </p>
        <div className="wizard-actions">
          {index > 0 && (
            <button
              type="button"
              className="secondary"
              disabled={!!busy}
              onClick={() => go(steps[index - 1].id)}
            >
              Back
            </button>
          )}
          <span className="wizard-progress" aria-hidden="true">
            Step {index + 1} of {steps.length}
          </span>
          <button
            className={action === 'create' ? 'accent' : undefined}
            disabled={!!busy || (action !== 'next' && !catalogReady && !pendingCreation)}
          >
            {busy
              ? 'Working…'
              : action === 'next'
                ? 'Continue'
                : action === 'preview'
                  ? step === 'rules'
                    ? 'Continue'
                    : 'Preview catalog and packs'
                  : pendingCreation
                    ? 'Retry realm creation'
                    : 'Create realm'}
          </button>
        </div>
      </form>
    </section>
  );
}
