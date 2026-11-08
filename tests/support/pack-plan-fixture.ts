import { customCatalog } from './catalog-fixture';
export const manualPlan = {
  schemaVersion: 1,
  categories: [
    { category: 'paper makers', name: 'Paper Trail' },
    { category: 'wind walkers', name: 'Wind Notes' },
  ],
};
export const overlapChoice = {
  rightsConfirmed: true,
  data: {
    ...customCatalog,
    characters: [{ ...customCatalog.characters[0], categories: ['paper makers', 'wind walkers'] }],
  },
};
