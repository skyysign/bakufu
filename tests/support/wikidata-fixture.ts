// Original labels on synthetic Q IDs; no third-party character dataset.
export const wikidataFixture = {
  success: 1,
  entities: {
    Q910000001: {
      id: 'Q910000001',
      type: 'item',
      labels: { en: { language: 'en', value: 'Vale of the Paper Sea' } },
      claims: { P18: [{ value: 'not-imported-artwork.png' }] },
      descriptions: { en: { value: 'not-imported-description' } },
    },
    Q910000002: {
      id: 'Q910000002',
      type: 'item',
      labels: { en: { language: 'en', value: 'Mira the Windkeeper' } },
    },
  },
};
export const wikidataRequest = {
  ids: ['Q910000001', 'Q910000002'],
  series: 'Paper Sea',
  medium: 'anime' as const,
  revision: 'original-fixture-1',
};
