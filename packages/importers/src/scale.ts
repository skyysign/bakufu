import { z } from 'zod';
import { providerCharacterId, majorCatalogCategories } from './providers';
import { catalogSchema } from './json';
export function generateScaleCatalog(count = 1000) {
  z.number().int().min(12).max(1000).parse(count);
  const titles = [
    'The Lantern Academy',
    'Cloudbreak Chronicle',
    'Paper Sea Pilgrims',
    'Copper Moon League',
    'The Quiet Observatory',
    'Wildgrove Detectives',
  ];
  return catalogSchema.parse({
    schemaVersion: 1,
    source: 'scale-demo',
    revision: `original-${count}-v1`,
    license: 'Original fictional scale-test text, MIT; no external data or artwork',
    characters: Array.from({ length: count }, (_, index) => ({
      id: providerCharacterId('scale-demo', index + 1),
      sourceKey: `scale-demo:character-${index + 1}`,
      name: `${['Aster', 'Mira', 'Reed', 'Sora', 'Vale', 'Nell', 'Ivo', 'Luma'][index % 8]} ${['Cloud', 'Tide', 'Moss', 'Copper', 'Star', 'Paper', 'Ember'][Math.floor(index / 8) % 7]} ${String(index + 1).padStart(4, '0')}`,
      series: titles[index % titles.length],
      categories: [
        majorCatalogCategories[index % majorCatalogCategories.length],
        majorCatalogCategories[(index + 5) % majorCatalogCategories.length],
      ],
      popularity: count - index,
    })),
  });
}
