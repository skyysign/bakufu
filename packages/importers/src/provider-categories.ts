import { isDemographicCategory } from '../../core/src/pack-themes';

// Used by server normalization and the browser's resumable catalog state.
// Keep this module free of transport and Node-only identity helpers.
export function boundedProviderCategories(values: string[]) {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
  // Demographic evidence drives pack grouping and must survive the category
  // bound even when the source also returns many genres and themes.
  return [
    ...unique.filter(isDemographicCategory),
    ...unique.filter((value) => !isDemographicCategory(value)),
  ]
    .slice(0, 20)
    .sort();
}
