'use client';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import {
  characterValuesSchema,
  defaultConfig,
  fitRankTracks,
  rankTracksSchema,
  tiers,
  type RankTrackBasis,
  type RankTrackBenefits,
  type RealmConfig,
  type Tier,
} from '@card-engine/config';
import { durationText } from './rank-track-view';

/* -------------------------------------------------------------------------- */
/* Settings layout primitives: every setting is one row, with its label and   */
/* help on the left and the control in one shared column on the right, so     */
/* controls line up no matter how long a label is.                            */
/* -------------------------------------------------------------------------- */

export type RulesCategory = 'economy' | 'collection' | 'progression' | 'ranks' | 'trading';
export const rulesCategories: { id: RulesCategory; label: string; help: string }[] = [
  { id: 'economy', label: 'Economy', help: 'Pack price, cards per pack, starting gems, cooldown and free gem claims.' },
  { id: 'collection', label: 'Collection', help: 'How often each rarity is drawn, what cards are worth, and wishlists.' },
  { id: 'progression', label: 'Progression', help: 'XP per new character and the level curve.' },
  { id: 'ranks', label: 'Collector ranks', help: 'Rank tracks players can buy, their costs and benefits.' },
  { id: 'trading', label: 'Trading', help: 'Whether players can trade, and the limits per offer.' },
];

export function RulesCategoryTabs({
  value,
  onChange,
  label,
}: {
  value: RulesCategory;
  onChange: (category: RulesCategory) => void;
  label: string;
}) {
  return (
    <>
      <div className="settings-category-tabs" role="tablist" aria-label={label}>
        {rulesCategories.map((category) => (
          <button
            key={category.id}
            type="button"
            role="tab"
            aria-selected={value === category.id}
            onClick={() => onChange(category.id)}
          >
            {category.label}
          </button>
        ))}
      </div>
      <p className="settings-category-help">
        {rulesCategories.find((category) => category.id === value)?.help}
      </p>
    </>
  );
}

export function SettingsGroup({
  id,
  title,
  description,
  action,
  category,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  category?: RulesCategory;
  children: ReactNode;
}) {
  return (
    <div className="settings-group" role="group" aria-labelledby={id} data-category={category}>
      <div className="settings-group-head">
        <div>
          <h4 id={id}>{title}</h4>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function SettingRow({
  id,
  label,
  help,
  wide = false,
  children,
}: {
  id: string;
  label: ReactNode;
  help?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={wide ? 'setting-row setting-row-wide' : 'setting-row'}>
      <div className="setting-text">
        <label htmlFor={id}>{label}</label>
        {help && (
          <p className="setting-help" id={`${id}-help`}>
            {help}
          </p>
        )}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

/** A number input with its unit shown inside the field (gems, hours, %). */
export function UnitInput({
  unit,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { unit?: string }) {
  return (
    <span className="unit-input">
      <input type="number" step={1} inputMode="decimal" {...props} />
      {unit && (
        <span className="unit-input-unit" aria-hidden="true">
          {unit}
        </span>
      )}
    </span>
  );
}

export function NumberSetting({
  id,
  name,
  label,
  help,
  unit,
  min = 0,
  max = 1_000_000,
  step = 1,
  defaultValue,
}: {
  id: string;
  name: string;
  label: string;
  help?: ReactNode;
  unit?: string;
  min?: number;
  max?: number;
  step?: number | 'any';
  defaultValue: number;
}) {
  return (
    <SettingRow id={id} label={label} help={help}>
      <UnitInput
        id={id}
        name={name}
        unit={unit}
        min={min}
        max={max}
        step={step}
        defaultValue={defaultValue}
        aria-describedby={help ? `${id}-help` : undefined}
        required
      />
    </SettingRow>
  );
}

/** An on/off setting shown as a switch on the right of its row. */
export function ToggleRow({
  id,
  name,
  label,
  help,
  checked,
  defaultChecked,
  onChange,
}: {
  id: string;
  name: string;
  label: string;
  help?: ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <div className="setting-row setting-toggle">
      <div className="setting-text">
        <label htmlFor={id}>{label}</label>
        {help && (
          <p className="setting-help" id={`${id}-help`}>
            {help}
          </p>
        )}
      </div>
      <div className="setting-control">
        <input
          id={id}
          name={name}
          type="checkbox"
          className="switch"
          checked={checked}
          defaultChecked={defaultChecked}
          aria-describedby={help ? `${id}-help` : undefined}
          onChange={onChange ? (event) => onChange(event.target.checked) : undefined}
        />
      </div>
    </div>
  );
}

/** Compares JSON text with a value regardless of key order (jsonb reorders keys). */
function sameJson(text: string, value: unknown) {
  const canonical = (input: unknown): unknown =>
    Array.isArray(input)
      ? input.map(canonical)
      : input && typeof input === 'object'
        ? Object.fromEntries(
            Object.entries(input)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, canonical(item)]),
          )
        : input;
  try {
    return JSON.stringify(canonical(JSON.parse(text))) === JSON.stringify(canonical(value));
  } catch {
    return false;
  }
}

/** Shown only while a group differs from the recommended values. */
function ResetButton({ visible, label, onClick }: { visible: boolean; label: string; onClick: () => void }) {
  if (!visible) return null;
  return (
    <button type="button" className="text-button settings-reset" onClick={onClick}>
      {label}
    </button>
  );
}

const tierLabel = (tier: Tier) => tier[0].toUpperCase() + tier.slice(1);
function hoursText(seconds: number) {
  const value = seconds / 3600;
  return String(Number(value.toFixed(4)));
}

/* ------------------------------ Rule groups ------------------------------ */

function GemRewardGroup({
  value,
  prefix,
  onChanged,
}: {
  value: RealmConfig['gemRewards'];
  prefix: string;
  onChanged?: () => void;
}) {
  const recommended = defaultConfig.gemRewards;
  const [enabled, setEnabled] = useState(value.enabled),
    [amount, setAmount] = useState(String(value.amount)),
    [hours, setHours] = useState(hoursText(value.intervalSeconds));
  const isRecommended =
    enabled === recommended.enabled &&
    Number(amount) === recommended.amount &&
    Math.round(Number(hours) * 3600) === recommended.intervalSeconds;
  return (
    <SettingsGroup
      id={`${prefix}-gem-rewards-title`}
      category="economy"
      title="Free gem claims"
      description="Players claim free gems on a timer. A claim is available right away, then once per interval."
      action={
        <ResetButton
          visible={!isRecommended}
          label={`Use recommended: ${recommended.amount.toLocaleString()} gems every ${hoursText(recommended.intervalSeconds)} h`}
          onClick={() => {
            setEnabled(recommended.enabled);
            setAmount(String(recommended.amount));
            setHours(hoursText(recommended.intervalSeconds));
            onChanged?.();
          }}
        />
      }
    >
      <ToggleRow
        id={`${prefix}-gemRewardsEnabled`}
        name="gemRewardsEnabled"
        label="Timed gem claims"
        help="Changes apply to future claims; balances and receipts stay intact."
        checked={enabled}
        onChange={(checked) => {
          setEnabled(checked);
          onChanged?.();
        }}
      />
      <SettingRow id={`${prefix}-gemRewardAmount`} label="Gems per claim">
        <UnitInput
          id={`${prefix}-gemRewardAmount`}
          name="gemRewardAmount"
          unit="gems"
          min={1}
          max={1_000_000}
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
            onChanged?.();
          }}
          required
        />
      </SettingRow>
      <SettingRow id={`${prefix}-gemRewardHours`} label="Claim interval" help="Minimum 1 minute.">
        <UnitInput
          id={`${prefix}-gemRewardHours`}
          name="gemRewardHours"
          unit="hours"
          min={1 / 60}
          max={744}
          step="any"
          value={hours}
          aria-describedby={`${prefix}-gemRewardHours-help`}
          onChange={(event) => {
            setHours(event.target.value);
            onChanged?.();
          }}
          required
        />
      </SettingRow>
    </SettingsGroup>
  );
}

function EconomyGroup({ config, prefix }: { config: RealmConfig; prefix: string }) {
  return (
    <SettingsGroup id={`${prefix}-economy-title`} category="economy" title="Packs and gems">
      <NumberSetting
        id={`${prefix}-packPrice`}
        name="packPrice"
        label="Pack price"
        unit="gems"
        help="Before collector-rank discounts."
        defaultValue={config.packPrice}
      />
      <NumberSetting
        id={`${prefix}-packSize`}
        name="packSize"
        label="Cards per pack"
        unit="cards"
        min={1}
        max={5}
        help="From 1 to 5."
        defaultValue={config.packSize}
      />
      <NumberSetting
        id={`${prefix}-startingGems`}
        name="startingGems"
        label="Starting gems"
        unit="gems"
        help="Given to players who join from now on."
        defaultValue={config.startingGems}
      />
      <NumberSetting
        id={`${prefix}-cooldownSeconds`}
        name="cooldownSeconds"
        label="Opening cooldown"
        unit="seconds"
        max={604800}
        help="Wait between pack openings. 0 means no wait."
        defaultValue={config.cooldownSeconds}
      />
    </SettingsGroup>
  );
}

function RarityGroup({
  config,
  prefix,
  onChanged,
}: {
  config: RealmConfig;
  prefix: string;
  onChanged?: () => void;
}) {
  const [weights, setWeights] = useState(() =>
    Object.fromEntries(tiers.map((tier) => [tier, String(config.tierWeights[tier])])),
  );
  const [values, setValues] = useState(() =>
    Object.fromEntries(tiers.map((tier) => [tier, String(config.recycleRewards[tier])])),
  );
  const total = tiers.reduce((sum, tier) => sum + Math.max(0, Number(weights[tier]) || 0), 0);
  const isRecommended = tiers.every(
    (tier) =>
      Number(weights[tier]) === defaultConfig.tierWeights[tier] &&
      Number(values[tier]) === defaultConfig.recycleRewards[tier],
  );
  const chance = (tier: Tier) => {
    const share = total ? (Math.max(0, Number(weights[tier]) || 0) / total) * 100 : 0;
    return share === 0 ? '0%' : share < 0.1 ? `${share.toFixed(2)}%` : `${share.toFixed(1)}%`;
  };
  return (
    <SettingsGroup
      id={`${prefix}-rarity-title`}
      category="collection"
      title="Rarity: chance and value"
      description="The weight sets how often a rarity is drawn. The base value is what a card is worth in gems when recycled and the suggested market price, before popularity and demand bonuses."
      action={
        <ResetButton
          visible={!isRecommended}
          label="Use recommended values"
          onClick={() => {
            setWeights(Object.fromEntries(tiers.map((tier) => [tier, String(defaultConfig.tierWeights[tier])])));
            setValues(Object.fromEntries(tiers.map((tier) => [tier, String(defaultConfig.recycleRewards[tier])])));
            onChanged?.();
          }}
        />
      }
    >
      <div className="tier-row tier-row-head" aria-hidden="true">
        <span>Rarity</span>
        <span>Draw weight</span>
        <span>Chance</span>
        <span>Base value</span>
      </div>
      {tiers.map((tier) => (
        <div className="tier-row" key={tier}>
          <span className="tier-name" data-tier={tier}>
            {tierLabel(tier)}
          </span>
          <div className="tier-weight">
          <UnitInput
            id={`${prefix}-weight-${tier}`}
            name={`weight-${tier}`}
            aria-label={`${tierLabel(tier)} draw weight`}
            unit="weight"
            min={0}
            max={10000}
            value={weights[tier]}
            onChange={(event) => {
              const next = event.target.value;
              setWeights((current) => ({ ...current, [tier]: next }));
              onChanged?.();
            }}
            required
          />
          </div>
          <span className="tier-chance">
            <span className="sr-only">{tierLabel(tier)} chance: </span>
            {chance(tier)}
          </span>
          <div className="tier-value">
          <UnitInput
            id={`${prefix}-reward-${tier}`}
            name={`reward-${tier}`}
            aria-label={`${tierLabel(tier)} base value`}
            unit="gems"
            min={0}
            max={1_000_000}
            value={values[tier]}
            onChange={(event) => {
              const next = event.target.value;
              setValues((current) => ({ ...current, [tier]: next }));
              onChanged?.();
            }}
            required
          />
          </div>
        </div>
      ))}
    </SettingsGroup>
  );
}

function RecyclingGroup({ value, prefix }: { value: boolean; prefix: string }) {
  return (
    <SettingsGroup
      id={`${prefix}-recycling-title`}
      category="collection"
      title="Recycling"
      description="Players recycle cards for their value in gems; the character goes back into the packs."
    >
      <ToggleRow
        id={`${prefix}-recycleSafeguard`}
        name="recycleSafeguard"
        label="Protect epic and legendary cards"
        help="Recycling an epic or legendary card needs a second confirmation, and recycling several cards at once leaves them out."
        defaultChecked={value}
      />
    </SettingsGroup>
  );
}

function CharacterValueGroup({ value, prefix }: { value: RealmConfig['characterValues']; prefix: string }) {
  return (
    <SettingsGroup
      id={`${prefix}-values-title`}
      category="collection"
      title="Popularity and demand"
      description="More popular characters and characters other collectors wish for are worth more, within their rarity. Sellers still choose their own asking price."
    >
      <ToggleRow
        id={`${prefix}-characterValuesEnabled`}
        name="characterValuesEnabled"
        label="Popularity and demand bonuses"
        defaultChecked={value.enabled}
      />
      <NumberSetting
        id={`${prefix}-popularityBoostBps`}
        name="popularityBoostBps"
        label="Maximum popularity bonus"
        help="For the most popular character of each rarity."
        unit="%"
        max={1000}
        step={0.01}
        defaultValue={value.popularityBoostBps / 100}
      />
      <NumberSetting
        id={`${prefix}-wishlistBoostBps`}
        name="wishlistBoostBps"
        label="Bonus per interested collector"
        unit="%"
        max={1000}
        step={0.01}
        defaultValue={value.wishlistBoostBps / 100}
      />
      <NumberSetting
        id={`${prefix}-maxWishlistBoostBps`}
        name="maxWishlistBoostBps"
        label="Maximum collector interest bonus"
        unit="%"
        max={1000}
        step={0.01}
        defaultValue={value.maxWishlistBoostBps / 100}
      />
    </SettingsGroup>
  );
}

function WishlistGroup({ value, prefix }: { value: RealmConfig['wishlist']; prefix: string }) {
  return (
    <SettingsGroup id={`${prefix}-wishlist-title`} category="collection" title="Wishlists">
      <NumberSetting
        id={`${prefix}-wishlistSlots`}
        name="wishlistSlots"
        label="Wishlist slots"
        help="0 turns wishlists off."
        unit="slots"
        max={20}
        defaultValue={value.slots}
      />
      <NumberSetting
        id={`${prefix}-wishlistMultiplier`}
        name="wishlistMultiplier"
        label="Wishlist weight multiplier"
        help="How much likelier a wished character is within its rarity. 1 keeps normal odds."
        unit="×"
        min={1}
        max={10}
        defaultValue={value.weightMultiplier}
      />
    </SettingsGroup>
  );
}

function ProgressionGroup({ value, prefix }: { value: RealmConfig['progression']; prefix: string }) {
  return (
    <SettingsGroup id={`${prefix}-progression-title`} category="progression" title="Experience and levels">
      <NumberSetting
        id={`${prefix}-xpPerNewCharacter`}
        name="xpPerNewCharacter"
        label="XP per new character"
        help="Once per player and character. Recycling and repeat claims give no XP."
        unit="XP"
        defaultValue={value.xpPerNewCharacter}
      />
      <SettingRow
        id={`${prefix}-levelThresholds`}
        label="Level thresholds"
        help="Total XP needed for each level, separated by commas, starting at 0. Changing them changes displayed levels only; XP stays intact."
        wide
      >
        <input
          id={`${prefix}-levelThresholds`}
          name="levelThresholds"
          defaultValue={value.levelThresholds.join(', ')}
          aria-describedby={`${prefix}-levelThresholds-help`}
          required
        />
      </SettingRow>
    </SettingsGroup>
  );
}

function TradingGroup({ value, prefix }: { value: RealmConfig['trading']; prefix: string }) {
  return (
    <SettingsGroup
      id={`${prefix}-trading-title`}
      category="trading"
      title="Trading"
      description="Both players must confirm the same offer. Existing trades keep the limits they were made with."
    >
      <ToggleRow
        id={`${prefix}-tradingEnabled`}
        name="tradingEnabled"
        label="Allow new trades"
        defaultChecked={value.enabled}
      />
      <NumberSetting
        id={`${prefix}-tradeCards`}
        name="tradeCards"
        label="Cards per player per trade"
        unit="cards"
        min={1}
        max={10}
        defaultValue={value.maxCardsPerSide}
      />
      <NumberSetting
        id={`${prefix}-tradeGems`}
        name="tradeGems"
        label="Gems per player per trade"
        unit="gems"
        defaultValue={value.maxGemsPerSide}
      />
      <NumberSetting
        id={`${prefix}-tradePending`}
        name="tradePending"
        label="Open trades per player"
        unit="trades"
        min={1}
        max={50}
        defaultValue={value.maxPendingPerPlayer}
      />
      <NumberSetting
        id={`${prefix}-tradeExpiry`}
        name="tradeExpiry"
        label="Trade expiry"
        help="Unanswered offers expire after this time (5 minutes to 7 days)."
        unit="minutes"
        min={5}
        max={10080}
        defaultValue={value.expiresAfterMinutes}
      />
    </SettingsGroup>
  );
}

const basisOf = (config: RealmConfig): RankTrackBasis => ({
  packPrice: config.packPrice,
  cooldownSeconds: config.cooldownSeconds,
  recycleRewards: config.recycleRewards,
  gemClaimSeconds: config.gemRewards.enabled ? config.gemRewards.intervalSeconds : 0,
});
/** The pack price, cooldown and card values currently typed into the form. */
function readBasis(form: HTMLFormElement, fallback: RankTrackBasis): RankTrackBasis {
  const data = new FormData(form);
  const number = (key: string, otherwise: number) => {
    const raw = data.get(key);
    const value = Number(raw);
    return raw === null || raw === '' || !Number.isFinite(value) ? otherwise : value;
  };
  const claimsOn = form.querySelector<HTMLInputElement>('input[name="gemRewardsEnabled"]');
  return {
    packPrice: number('packPrice', fallback.packPrice),
    cooldownSeconds: number('cooldownSeconds', fallback.cooldownSeconds),
    gemClaimSeconds:
      claimsOn && !claimsOn.checked
        ? 0
        : Math.round(number('gemRewardHours', (fallback.gemClaimSeconds ?? 0) / 3600) * 3600),
    recycleRewards: Object.fromEntries(
      tiers.map((tier) => [tier, number(`reward-${tier}`, fallback.recycleRewards[tier] ?? 0)]),
    ),
  };
}
function perksText(benefits: RankTrackBenefits) {
  return [
    benefits.packDiscount && `${benefits.packDiscount.toLocaleString()} gems off packs`,
    benefits.recycleBonus && `+${benefits.recycleBonus.toLocaleString()} gems per recycling`,
    benefits.wishlistSlots && `+${benefits.wishlistSlots} wishlist slots`,
    benefits.gemClaimReductionSeconds &&
      `free gems ${durationText(benefits.gemClaimReductionSeconds)} sooner`,
    benefits.cooldownReductionSeconds &&
      `${durationText(benefits.cooldownReductionSeconds)} less opening cooldown`,
  ]
    .filter(Boolean)
    .join(' · ');
}

function RankTrackGroup({
  config,
  value,
  prefix,
  rulesVersion,
  ownedLevels,
  onChanged,
}: {
  config: RealmConfig;
  value: RealmConfig['rankTracks'];
  prefix: string;
  rulesVersion: number;
  ownedLevels: Record<string, number>;
  onChanged?: () => void;
}) {
  const [enabled, setEnabled] = useState(value.enabled),
    [tracks, setTracks] = useState(JSON.stringify(value.tracks, null, 2));
  // Recommended ranks are measured against the rules in this form, live.
  const anchor = useRef<HTMLDivElement>(null);
  const [basis, setBasis] = useState(() => basisOf(config));
  useEffect(() => {
    const form = anchor.current?.closest('form');
    if (!form) return;
    const update = () =>
      setBasis((current) => {
        const next = readBasis(form, basisOf(config));
        return JSON.stringify(next) === JSON.stringify(current) ? current : next;
      });
    update();
    form.addEventListener('input', update);
    return () => form.removeEventListener('input', update);
  }, [config, rulesVersion]);
  const fittedText = useMemo(
    () => JSON.stringify(fitRankTracks(value, basis, ownedLevels).tracks, null, 2),
    [value, basis, ownedLevels],
  );
  // Ranks that matched the recommendation keep following the rules as they
  // change; edited ranks stay as they are until "Fit ranks" is chosen.
  const previousFit = useRef(fittedText);
  useEffect(() => {
    const previous = previousFit.current;
    previousFit.current = fittedText;
    if (previous !== fittedText)
      setTracks((current) => (sameJson(current, JSON.parse(previous)) ? fittedText : current));
  }, [fittedText]);
  const owned = Object.values(ownedLevels).some((level) => level > 0);
  const summary = useMemo(() => {
    try {
      const parsed = rankTracksSchema.parse({ enabled: true, tracks: JSON.parse(tracks) });
      return parsed.tracks.map((track) => ({
        id: track.id,
        name: track.name,
        levels: track.levels.length,
        from: Math.min(...track.levels.map((level) => level.cost)),
        to: Math.max(...track.levels.map((level) => level.cost)),
        perks: perksText(track.levels[track.levels.length - 1].benefits),
      }));
    } catch {
      return null;
    }
  }, [tracks]);
  return (
    <SettingsGroup
      id={`${prefix}-ranks-title`}
      category="ranks"
      title="Collector ranks"
      description="Players spend gems on rank levels for lasting perks. Recommended ranks follow your pack price, free gem claim interval, opening cooldown and common card value: costs are counted in packs, and each perk is a share of what it improves. Owned levels are never taken away."
      action={
        <ResetButton
          visible={!enabled || !sameJson(tracks, JSON.parse(fittedText))}
          label="Fit ranks to these rules"
          onClick={() => {
            setEnabled(true);
            setTracks(fittedText);
            onChanged?.();
          }}
        />
      }
    >
      <div ref={anchor} hidden />
      <ToggleRow
        id={`${prefix}-rankTracksEnabled`}
        name="rankTracksEnabled"
        label="Leveled collector ranks"
        checked={enabled}
        onChange={(checked) => {
          setEnabled(checked);
          onChanged?.();
        }}
      />
      {summary ? (
        <ul className="rank-track-summary" aria-label="Rank tracks">
          {summary.map((track) => (
            <li key={track.id}>
              <strong>{track.name}</strong>
              <span>
                {track.levels} {track.levels === 1 ? 'level' : 'levels'} ·{' '}
                {track.from === track.to
                  ? `${track.from.toLocaleString()} gems`
                  : `${track.from.toLocaleString()}–${track.to.toLocaleString()} gems`}
                {track.perks && <> · top level: {track.perks}</>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="settings-inline-error">The rank JSON below is not valid yet.</p>
      )}
      {owned && (
        <p className="setting-help">
          Levels players already bought keep their costs and perks when ranks are fitted; only the
          levels nobody owns yet change.
        </p>
      )}
      <details className="settings-json">
        <summary>Edit ranks as JSON</summary>
        <label htmlFor={`${prefix}-rank-tracks`}>
          Tracks, level costs, benefits and prerequisites (JSON)
        </label>
        <textarea
          id={`${prefix}-rank-tracks`}
          name="rankTrackRules"
          value={tracks}
          rows={12}
          spellCheck={false}
          onChange={(event) => {
            setTracks(event.target.value);
            onChanged?.();
          }}
        />
        <p className="setting-help">
          Benefits are totals within each rank. Owned levels and unlock requirements are protected
          after purchase.
        </p>
      </details>
    </SettingsGroup>
  );
}

/** Every gameplay rule group; each one carries its category for tabbed views. */
const noOwnedLevels: Record<string, number> = {};
export function RulesFields({
  config,
  prefix,
  onChanged,
  ownedRankLevels = noOwnedLevels,
}: {
  config: RealmConfig;
  prefix: string;
  onChanged?: () => void;
  /** Highest level any player owns per rank track (kept when ranks are fitted). */
  ownedRankLevels?: Record<string, number>;
}) {
  // Bumped when a group changes values without typing (a "recommended" button).
  const [rulesVersion, setRulesVersion] = useState(0);
  const changed = () => {
    onChanged?.();
    setRulesVersion((version) => version + 1);
  };
  return (
    <>
      <EconomyGroup config={config} prefix={prefix} />
      <GemRewardGroup value={config.gemRewards} prefix={prefix} onChanged={changed} />
      <RarityGroup config={config} prefix={prefix} onChanged={changed} />
      <RecyclingGroup value={config.recycleSafeguard} prefix={prefix} />
      <CharacterValueGroup value={config.characterValues} prefix={prefix} />
      <WishlistGroup value={config.wishlist} prefix={prefix} />
      <ProgressionGroup value={config.progression} prefix={prefix} />
      <RankTrackGroup
        config={config}
        value={config.rankTracks}
        prefix={prefix}
        rulesVersion={rulesVersion}
        ownedLevels={ownedRankLevels}
        onChanged={onChanged}
      />
      <TradingGroup value={config.trading} prefix={prefix} />
    </>
  );
}

export function readRankTracks(form: FormData) {
  let tracks: unknown;
  try {
    tracks = JSON.parse(String(form.get('rankTrackRules') ?? '[]'));
  } catch {
    throw new Error('Enter valid JSON collector rank tracks.');
  }
  return rankTracksSchema.parse({ enabled: form.get('rankTracksEnabled') === 'on', tracks });
}

/** Reads the fields rendered by RulesFields. Callers merge and validate the result. */
export function readRules(form: FormData) {
  const number = (key: string) => Number(form.get(key));
  const thresholds = String(form.get('levelThresholds') ?? '').split(',');
  if (thresholds.some((value) => !value.trim()))
    throw new Error('Enter level thresholds as whole numbers separated by commas, starting at 0.');
  let characterValues;
  try {
    characterValues = characterValuesSchema.parse({
      schemaVersion: 1,
      enabled: form.get('characterValuesEnabled') === 'on',
      popularityBoostBps: Math.round(number('popularityBoostBps') * 100),
      wishlistBoostBps: Math.round(number('wishlistBoostBps') * 100),
      maxWishlistBoostBps: Math.round(number('maxWishlistBoostBps') * 100),
    });
  } catch {
    throw new Error('Use popularity and demand bonuses between 0% and 1,000%.');
  }
  let rankTracks;
  try {
    rankTracks = readRankTracks(form);
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message.startsWith('Enter')
        ? error.message
        : 'Check the collector rank JSON: every track needs an id, a name and levels with costs and benefits.',
    );
  }
  return {
    packPrice: number('packPrice'),
    packSize: number('packSize'),
    startingGems: number('startingGems'),
    cooldownSeconds: number('cooldownSeconds'),
    tierWeights: Object.fromEntries(tiers.map((tier) => [tier, number(`weight-${tier}`)])) as Record<Tier, number>,
    recycleRewards: Object.fromEntries(tiers.map((tier) => [tier, number(`reward-${tier}`)])) as Record<Tier, number>,
    progression: {
      xpPerNewCharacter: number('xpPerNewCharacter'),
      levelThresholds: thresholds.map(Number),
    },
    wishlist: { slots: number('wishlistSlots'), weightMultiplier: number('wishlistMultiplier') },
    trading: {
      enabled: form.get('tradingEnabled') === 'on',
      maxCardsPerSide: number('tradeCards'),
      maxGemsPerSide: number('tradeGems'),
      maxPendingPerPlayer: number('tradePending'),
      expiresAfterMinutes: number('tradeExpiry'),
    },
    rankTracks,
    recycleSafeguard: form.get('recycleSafeguard') === 'on',
    gemRewards: {
      enabled: form.get('gemRewardsEnabled') === 'on',
      amount: number('gemRewardAmount'),
      intervalSeconds: Math.round(number('gemRewardHours') * 3600),
    },
    characterValues,
  };
}
