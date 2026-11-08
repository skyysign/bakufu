import { providerArtworkSchema } from '../../importers/src/artwork';
import type { Transaction } from './connection';

// Recovery restores references and attribution, never third-party image bytes.
export async function validateArtworkReferences(tx: Transaction): Promise<void> {
  const rows = (
    await tx.query(`SELECT provenance->'artwork' AS artwork FROM characters WHERE provenance ? 'artwork'
      UNION ALL SELECT character->'artwork' AS artwork FROM openings
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(result->'characters','[]'::jsonb)) AS character
      WHERE character ? 'artwork'`)
  ).rows;
  if (rows.some((row) => !providerArtworkSchema.safeParse(row.artwork).success))
    throw new Error('Backup artwork references must use supported provider URLs and attribution.');
}
