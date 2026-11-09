import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { catalogSchema } from '../packages/importers/src/json';
import { fetchJikanApiStep, jikanPacing } from '../packages/importers/src/jikan';
import {
  applyJikanWorks,
  jikanCharactersDefault,
  jikanSeedLimits,
  mergeJikanCharacters,
  migrateJikanSeed,
  newJikanSeed,
  nextJikanStep,
  type JikanSeedState,
} from '../packages/importers/src/jikan-state';

// Explicit operator command; never invoked by automated tests, startup or builds.
const args = process.argv.slice(2);
function option(name: string) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}
const output = resolve(option('--output') ?? '.test-data/anime-1000.catalog.json'),
  checkpoint = output + '.progress.json',
  medium = option('--medium') ?? 'anime',
  service = option('--service') ?? 'tenrai',
  target = Number(option('--characters') ?? 1000),
  perWork = Number(option('--per-series') ?? jikanCharactersDefault),
  artworkPermission = option('--artwork-permission');
if (!args.includes('--confirm-provider-use'))
  throw new Error(
    'Review the selected API and MyAnimeList usage policies, then pass --confirm-provider-use.',
  );
if (medium !== 'anime' && medium !== 'manga' && medium !== 'both')
  throw new Error('Choose --medium anime, manga or both.');
if (service !== 'tenrai' && service !== 'jikan')
  throw new Error('Choose --service tenrai or jikan.');
let state: JikanSeedState = newJikanSeed(medium, target, service, perWork);
if (args.includes('--resume')) {
  state = migrateJikanSeed(JSON.parse(await readFile(checkpoint, 'utf8')));
  const media = medium === 'both' ? ['anime', 'manga'] : [medium];
  if (
    state.media.join() !== media.join() ||
    state.service !== service ||
    state.target !== target ||
    Object.values(state.cursors).some(
      (cursor) => !cursor || cursor.page < 0 || cursor.page > jikanSeedLimits.maxPages,
    ) ||
    state.completed.length > jikanSeedLimits.maxPages * 25 * state.media.length
  )
    throw new Error('The checkpoint does not match this bounded selection.');
  if (state.catalog.characters.length) catalogSchema.parse(state.catalog);
}
await mkdir(dirname(output), { recursive: true });
async function save() {
  await writeFile(checkpoint + '.tmp', JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
  await rename(checkpoint + '.tmp', checkpoint);
}
let requests = 0;
try {
  for (let next = nextJikanStep(state); next; next = nextJikanStep(state)) {
    await delay(jikanPacing[service].delayMs);
    const common = {
      provider: 'jikan-api',
      medium: next.medium,
      service,
      revision: state.revision,
      providerConsent: true,
      termsConfirmed: true,
    };
    if (next.step === 'works') {
      const result = await fetchJikanApiStep({ ...common, step: 'works', page: next.page });
      if (result.kind !== 'works') throw new Error('Unexpected provider response.');
      state = applyJikanWorks(state, next.medium, result);
    } else {
      const result = await fetchJikanApiStep({
        ...common,
        step: 'characters',
        work: next.work,
        perWork: state.perWork,
        ...(artworkPermission ? { artworkPermission } : {}),
      });
      if (result.kind !== 'characters') throw new Error('Unexpected provider response.');
      state = mergeJikanCharacters(state, result);
    }
    requests++;
    await save();
    console.log(
      JSON.stringify({
        characters: state.catalog.characters.length,
        target: state.target,
        completedSeries: state.completed.length,
        requests,
        pages: state.cursors,
      }),
    );
  }
  const catalog = catalogSchema.parse(state.catalog);
  await writeFile(output + '.tmp', JSON.stringify(catalog, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(output + '.tmp', output);
  console.log(
    JSON.stringify({
      saved: true,
      characters: catalog.characters.length,
      target,
      complete: catalog.characters.length === target,
      artworkReferences: catalog.characters.filter((character) => !!character.artwork).length,
      downloadedImages: 0,
      series: state.completed.length,
      requests,
    }),
  );
  if (catalog.characters.length !== target) process.exitCode = 2;
} catch (error) {
  await save();
  console.error(error instanceof Error ? error.message : 'Preparation paused.');
  console.error(
    'Progress saved. Rerun with --resume after the provider is available. No automatic retry was made.',
  );
  process.exitCode = 1;
}
