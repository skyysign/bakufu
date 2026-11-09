// Explicit historical rules for regression fixtures. New product defaults are
// tested separately; old concurrency/ledger assertions keep their exact prices.
import {
  defaultConfig as current,
  defaultCollectorRanks,
  defaultUpgrades,
  disabledRankTracks,
  disabledCharacterValues,
  disabledFameFloors,
} from '../../packages/config/src/index';
export const defaultConfig = {
  ...current,
  legacyPurchasesRetired: false,
  packPrice: 10,
  startingGems: 100,
  cooldownSeconds: 0,
  tierWeights: { common: 70, uncommon: 25, rare: 5, epic: 0, legendary: 0 },
  recycleRewards: { common: 2, uncommon: 4, rare: 6, epic: 0, legendary: 0 },
  ranks: defaultCollectorRanks,
  upgrades: defaultUpgrades,
  rankTracks: disabledRankTracks,
  gemRewards: { ...current.gemRewards, amount: 25 },
  characterValues: disabledCharacterValues,
  // These fixtures predate fame floors and use original (non-provider) catalogs.
  fameFloors: disabledFameFloors,
};
export function legacyRules<
  T extends {
    tierWeights: Record<string, number>;
    recycleRewards?: Record<string, number>;
    rankTracks?: unknown;
    legacyPurchasesRetired?: boolean;
    characterValues?: unknown;
    fameFloors?: unknown;
  },
>(input: T) {
  const {
    rankTracks: _tracks,
    legacyPurchasesRetired: _retired,
    characterValues: _values,
    fameFloors: _floors,
    ...rules
  } = input;
  void _values;
  void _floors;
  void _retired;
  void _tracks;
  const three = (values: Record<string, number>) => ({
    common: values.common,
    uncommon: values.uncommon,
    rare: values.rare,
  });
  return {
    ...rules,
    tierWeights: three(input.tierWeights),
    ...(input.recycleRewards ? { recycleRewards: three(input.recycleRewards) } : {}),
  };
}
