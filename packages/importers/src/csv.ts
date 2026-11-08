import { parse, CsvError } from 'csv-parse/sync';
import { z } from 'zod';
import { catalogMetadataSchema, parseCatalog } from './json';

export const originalCatalogMaxBytes = 2 * 1024 * 1024;
export const originalCatalogMaxEntries = 1000;
export const csvColumns = [
  'id',
  'sourceKey',
  'name',
  'series',
  'categories',
  'popularity',
] as const;
export class CatalogImportError extends Error {}

export function parseCsvCatalog(text: string, input: unknown) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > originalCatalogMaxBytes)
    throw new CatalogImportError('CSV must be UTF-8 text smaller than 2 MiB.');
  if (text.includes('\0'))
    throw new CatalogImportError('CSV contains a null character. Save the file as UTF-8.');
  const metadata = catalogMetadataSchema.safeParse(input);
  if (
    !metadata.success ||
    Object.values(metadata.data).some((value) => typeof value === 'string' && value.includes('\0'))
  )
    throw new CatalogImportError(
      'Enter valid catalog version 1 source, revision, and permission details.',
    );
  let rows: string[][];
  try {
    rows = parse(text, {
      bom: true,
      delimiter: ',',
      skip_empty_lines: true,
      max_record_size: 16384,
      // Keep strict quoting/field counts. Never skip a malformed character row.
      on_record(record, context) {
        if (context.records > originalCatalogMaxEntries + 1)
          throw new CatalogImportError('Use at most 1,000 characters in the CSV catalog.');
        return record;
      },
    });
  } catch (error) {
    if (error instanceof CatalogImportError) throw error;
    if (error instanceof CsvError && error.code === 'CSV_MAX_RECORD_SIZE')
      throw new CatalogImportError(
        'A CSV record is too long. Check character names and category lengths.',
      );
    // Parser errors can include raw field values: never expose their message.
    throw new CatalogImportError(
      'Malformed CSV. Use comma-separated columns, matching double quotes, and the same six fields on every record.',
    );
  }
  const header = rows.shift()?.map((value) => value.trim());
  if (
    !header ||
    header.length !== csvColumns.length ||
    new Set(header).size !== csvColumns.length ||
    csvColumns.some((column) => !header.includes(column))
  )
    throw new CatalogImportError(
      'CSV headers must contain id, sourceKey, name, series, categories, and popularity exactly once.',
    );
  if (!rows.length) throw new CatalogImportError('CSV must contain at least one character record.');
  const characters = rows.map((row, index) => {
    const field = (column: (typeof csvColumns)[number]) => row[header.indexOf(column)].trim();
    const popularity = field('popularity'),
      categoryText = field('categories');
    if (popularity && (!/^\d+$/.test(popularity) || !Number.isSafeInteger(Number(popularity))))
      throw new CatalogImportError(
        `CSV record ${index + 2}: popularity must be blank or a nonnegative whole number.`,
      );
    return {
      id: field('id'),
      sourceKey: field('sourceKey'),
      name: field('name'),
      series: field('series'),
      categories: categoryText ? categoryText.split('|') : [],
      popularity: popularity ? Number(popularity) : null,
    };
  });
  try {
    return parseCatalog({ ...metadata.data, characters });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issue = error.issues[0],
        index =
          issue.path[0] === 'characters' && typeof issue.path[1] === 'number'
            ? issue.path[1]
            : undefined;
      const field =
        typeof issue.path[2] === 'string' &&
        csvColumns.includes(issue.path[2] as (typeof csvColumns)[number])
          ? issue.path[2]
          : undefined;
      throw new CatalogImportError(
        index === undefined
          ? 'CSV has duplicate character IDs/source keys or a key outside the declared source.'
          : `CSV record ${index + 2}${field ? ` (${field})` : ''} is invalid. Check UUID, text lengths, categories, and source-key format.`,
      );
    }
    throw new CatalogImportError('The CSV catalog could not be validated.');
  }
}
