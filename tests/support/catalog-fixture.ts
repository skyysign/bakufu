import { readFileSync } from 'node:fs';
// Original fictional text only. UUIDs and source keys deliberately stable.
export const customCatalog = {
  schemaVersion: 1,
  source: 'workshop',
  revision: 'original-1',
  license: 'Original fictional test content, MIT',
  characters: ['Vale', 'Reed', 'Moss', 'Kite'].map((name, index) => ({
    id: `c5000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    sourceKey: `workshop:${name.toLowerCase()}`,
    name,
    series: 'The Paper Workshop',
    categories: [index < 2 ? 'paper makers' : 'wind walkers'],
    popularity: 40 - index * 10,
  })),
};
export const customChoice = { data: customCatalog, rightsConfirmed: true };
export const csvMetadata = {
  schemaVersion: 1,
  source: customCatalog.source,
  revision: customCatalog.revision,
  license: customCatalog.license,
};
export const csvCatalog = readFileSync(
  new URL('../../packages/importers/fixtures/workshop.v1.csv', import.meta.url),
  'utf8',
);
export const csvChoice = {
  format: 'csv',
  data: csvCatalog,
  metadata: csvMetadata,
  rightsConfirmed: true,
};
