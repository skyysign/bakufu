import type { JikanCharactersResult, JikanWork, JikanWorksResult } from './jikan';
import { boundedProviderCategories } from './provider-categories';

export type JikanMedium = 'anime' | 'manga';
export type JikanQueuedWork = JikanWork & { medium: JikanMedium };
/** Bounds shared by the browser preparation and the operator command. */
export const jikanSeedLimits = {
  maxTarget: 100_000,
  maxPages: 400,
  minPerWork: 5,
  maxPerWork: 50,
} as const;

/**
 * Resumable, serializable preparation state. Popular series are paged per
 * medium (round-robin for anime + manga); each series contributes its main
 * characters first, then its most favourited supporting cast.
 */
export type JikanSeedState = {
  schemaVersion: 2;
  media: JikanMedium[];
  service: 'tenrai' | 'jikan';
  revision: string;
  target: number;
  perWork: number;
  cursors: Partial<Record<JikanMedium, { page: number; hasNextPage: boolean }>>;
  queue: JikanQueuedWork[];
  /** `${medium}:${id}`: anime and manga IDs are separate MAL namespaces. */
  completed: string[];
  catalog: JikanCharactersResult['catalog'];
};
export type JikanNextStep =
  | { step: 'works'; medium: JikanMedium; page: number }
  | { step: 'characters'; medium: JikanMedium; work: JikanWork }
  | null;

const license = (service: 'tenrai' | 'jikan') =>
  `${service === 'tenrai' ? 'Tenrai' : 'Jikan'} / MyAnimeList selected metadata; operator-confirmed permitted use; artwork rights separate`;

export function newJikanSeed(
  medium: JikanMedium | 'both' | JikanMedium[],
  target = 1000,
  service: 'tenrai' | 'jikan' = 'tenrai',
  perWork: number = jikanSeedLimits.maxPerWork,
): JikanSeedState {
  if (!Number.isInteger(target) || target < 1 || target > jikanSeedLimits.maxTarget)
    throw new Error(`Choose 1 to ${jikanSeedLimits.maxTarget.toLocaleString('en')} characters.`);
  if (
    !Number.isInteger(perWork) ||
    perWork < jikanSeedLimits.minPerWork ||
    perWork > jikanSeedLimits.maxPerWork
  )
    throw new Error('Choose 5 to 50 characters per series.');
  const media: JikanMedium[] =
    medium === 'both'
      ? ['anime', 'manga']
      : Array.isArray(medium)
        ? [...new Set(medium)]
        : [medium];
  if (!media.length || media.some((value) => value !== 'anime' && value !== 'manga'))
    throw new Error('Choose anime, manga or both.');
  return {
    schemaVersion: 2,
    media,
    service,
    revision: 'selected-api-1',
    target,
    perWork,
    cursors: Object.fromEntries(media.map((value) => [value, { page: 0, hasNextPage: true }])),
    queue: [],
    completed: [],
    catalog: {
      schemaVersion: 1,
      source: 'mal',
      revision: 'selected-api-1',
      license: license(service),
      characters: [],
    },
  };
}

/** Accepts saved v1 checkpoints (single medium, eight pages) and v2 state. */
export function migrateJikanSeed(input: unknown): JikanSeedState {
  const value = input as Record<string, unknown>;
  if (value?.schemaVersion === 2) return value as unknown as JikanSeedState;
  if (value?.schemaVersion !== 1) throw new Error('Unsupported preparation checkpoint.');
  const v1 = value as unknown as {
    medium: JikanMedium;
    service: 'tenrai' | 'jikan';
    revision: string;
    target: number;
    page: number;
    hasNextPage: boolean;
    queue: JikanWork[];
    completed: number[];
    catalog: JikanSeedState['catalog'];
  };
  return {
    schemaVersion: 2,
    media: [v1.medium],
    service: v1.service,
    revision: v1.revision,
    target: v1.target,
    perWork: jikanSeedLimits.maxPerWork,
    cursors: { [v1.medium]: { page: v1.page, hasNextPage: v1.hasNextPage } },
    queue: v1.queue.map((work) => ({ ...work, medium: v1.medium })),
    completed: v1.completed.map((id) => `${v1.medium}:${id}`),
    catalog: v1.catalog,
  };
}

/** The single next request, or null when the target or the source is exhausted. */
export function nextJikanStep(state: JikanSeedState): JikanNextStep {
  if (state.catalog.characters.length >= state.target) return null;
  const queued = state.queue[0];
  if (queued) {
    const { medium, ...work } = queued;
    return { step: 'characters', medium, work };
  }
  // Round-robin: the medium with the fewest pages fetched goes next.
  const open = state.media
    .map((medium) => ({
      medium,
      cursor: state.cursors[medium] ?? { page: 0, hasNextPage: true },
    }))
    .filter(({ cursor }) => cursor.hasNextPage && cursor.page < jikanSeedLimits.maxPages)
    .sort((a, b) => a.cursor.page - b.cursor.page);
  if (!open.length) return null;
  return {
    step: 'works',
    medium: open[0].medium,
    page: open[0].cursor.page + 1,
  };
}

export function applyJikanWorks(
  state: JikanSeedState,
  medium: JikanMedium,
  result: JikanWorksResult,
): JikanSeedState {
  const done = new Set(state.completed);
  const queued = new Set(state.queue.map((work) => `${work.medium}:${work.id}`));
  return {
    ...state,
    cursors: {
      ...state.cursors,
      [medium]: { page: result.page, hasNextPage: result.hasNextPage },
    },
    queue: [
      ...state.queue,
      ...result.works
        .filter((work) => !done.has(`${medium}:${work.id}`) && !queued.has(`${medium}:${work.id}`))
        .map((work) => ({ ...work, medium })),
    ],
  };
}

export function mergeJikanCharacters(
  state: JikanSeedState,
  result: JikanCharactersResult,
): JikanSeedState {
  const medium = result.medium ?? state.media[0];
  const all = new Map(
    state.catalog.characters.map((character) => [character.sourceKey, character]),
  );
  for (const character of result.catalog.characters) {
    const previous = all.get(character.sourceKey);
    if (previous)
      all.set(character.sourceKey, {
        ...previous,
        categories: boundedProviderCategories([...previous.categories, ...character.categories]),
        ...(previous.artwork ? {} : character.artwork ? { artwork: character.artwork } : {}),
        // Main cast in any of its series counts as main.
        ...(character.role === 'main' ? { role: 'main' as const } : {}),
      });
    else if (all.size < state.target) all.set(character.sourceKey, character);
  }
  const key = `${medium}:${result.work.id}`;
  return {
    ...state,
    completed: [...new Set([...state.completed, key])],
    queue: state.queue.filter((work) => `${work.medium}:${work.id}` !== key),
    catalog: { ...state.catalog, characters: [...all.values()] },
  };
}
