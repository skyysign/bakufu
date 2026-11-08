import { describe, it, expect } from 'vitest';
import {
  parseCatalog,
  parseCsvCatalog,
  CatalogImportError,
} from '../../packages/importers/src/index';
import { prepareRealmCatalog } from '../../packages/db/src/catalog';
import {} from '../../packages/config/src/index';
import { defaultConfig } from '../support/prototype-config';
import {
  customCatalog,
  customChoice,
  csvCatalog,
  csvChoice,
  csvMetadata,
} from '../support/catalog-fixture';

const header = 'id,sourceKey,name,series,categories,popularity';
const id = 'c5000000-0000-4000-8000-000000000001';
describe('strict original CSV adapter', () => {
  it('preserves JSON UUIDs, source keys, normalized fields, tiers, and packs', () => {
    expect(parseCsvCatalog(csvCatalog, csvMetadata)).toEqual(parseCatalog(customCatalog));
    const csv = prepareRealmCatalog(defaultConfig, csvChoice).preview,
      json = prepareRealmCatalog(defaultConfig, customChoice).preview;
    expect({ ...csv, fingerprint: json.fingerprint, kind: json.kind }).toEqual(json);
    expect(csv.kind).toBe('original-csv');
    expect(csv.fingerprint).not.toBe(json.fingerprint);
  });
  it('supports UTF-8 BOM, CRLF, quoted commas/newlines/doubled quotes, and pipe categories', () => {
    const text = `\ufeff${header}\r\n${id},workshop:vale,"Vále, the ""Keeper""","Paper\r\nWorkshop","paper makers|wind walkers| paper makers ",\r\n\r\n`;
    const result = parseCsvCatalog(text, csvMetadata);
    expect(result.characters[0]).toMatchObject({
      name: 'Vále, the "Keeper"',
      series: 'Paper\r\nWorkshop',
      categories: ['paper makers', 'wind walkers'],
      tier: 'common',
    });
    expect(result.catalog.characters[0].popularity).toBeNull();
  });
  it('accepts reordered exact headers and zero popularity without inventing IDs or categories', () => {
    const result = parseCsvCatalog(
      `popularity, categories,series,name,sourceKey,id\n0000,,Workshop,Vale,workshop:vale,${id}`,
      csvMetadata,
    );
    expect(result.catalog.characters[0]).toMatchObject({ id, categories: [], popularity: 0 });
  });
  it('rejects missing, duplicate, extra, case-changed, and semicolon headers', () => {
    for (const input of [
      header.replace('id,', ''),
      header.replace('popularity', 'name'),
      `${header},imageUrl`,
      header.replace('sourceKey', 'sourcekey'),
      header.replaceAll(',', ';'),
      'name,series',
      '',
    ])
      expect(() => parseCsvCatalog(input, csvMetadata)).toThrow(CatalogImportError);
  });
  it('rejects malformed quoting and inconsistent row widths without leaking parser values', () => {
    for (const row of [
      `${id},workshop:vale,"private-submitted-secret,Workshop,paper makers,4`,
      `${id},workshop:vale,private-submitted-secret`,
      `${id},workshop:vale,Name,Workshop,,4,private-submitted-secret`,
    ]) {
      let message = '';
      try {
        parseCsvCatalog(`${header}\n${row}`, csvMetadata);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain('Malformed CSV');
      expect(message).not.toContain('private-submitted-secret');
    }
  });
  it('only accepts blank or unsigned decimal safe integers for popularity', () => {
    for (const value of ['-1', '1.5', '1e3', '0x10', 'NaN', 'null', '9007199254740992'])
      expect(() =>
        parseCsvCatalog(`${header}\n${id},workshop:vale,Vale,Workshop,,${value}`, csvMetadata),
      ).toThrow('record 2: popularity');
  });
  it('fails the whole file for duplicate keys/IDs, foreign sources, or invalid character fields', () => {
    expect(() =>
      parseCsvCatalog(`${csvCatalog.trim()}\n${csvCatalog.trim().split('\n')[1]}`, csvMetadata),
    ).toThrow('duplicate');
    expect(() =>
      parseCsvCatalog(csvCatalog.replace('workshop:vale', 'elsewhere:vale'), csvMetadata),
    ).toThrow('declared source');
    expect(() =>
      parseCsvCatalog(csvCatalog.replace('workshop:vale', 'workshop:reed'), csvMetadata),
    ).toThrow('duplicate');
    expect(() =>
      parseCsvCatalog(`${header}\ninvalid-id,workshop:vale,Vale,Workshop,,1`, csvMetadata),
    ).toThrow('record 2 (id)');
    expect(() =>
      parseCsvCatalog(`${header}\n${id},workshop:vale,Vale,Workshop,paper||wind,1`, csvMetadata),
    ).toThrow('categories');
    expect(() => parseCsvCatalog(header, csvMetadata)).toThrow('at least one');
  });
  it('requires metadata v1 and bounds file bytes, record size, row count, and text encoding', () => {
    expect(() => parseCsvCatalog(csvCatalog, { ...csvMetadata, schemaVersion: 2 })).toThrow(
      'version 1',
    );
    expect(() => parseCsvCatalog(csvCatalog, { ...csvMetadata, source: '' })).toThrow();
    expect(() => parseCsvCatalog(csvCatalog + '\0', csvMetadata)).toThrow('null character');
    expect(() => parseCsvCatalog('x'.repeat(2 * 1024 * 1024 + 1), csvMetadata)).toThrow('2 MiB');
    expect(() =>
      parseCsvCatalog(
        `${header}\n${id},workshop:vale,${'x'.repeat(17000)},Workshop,,1`,
        csvMetadata,
      ),
    ).toThrow('record is too long');
    expect(() =>
      parseCsvCatalog(
        `${header}\n${Array.from({ length: 1001 }, () => `${id},workshop:vale,Vale,Workshop,,1`).join('\n')}`,
        csvMetadata,
      ),
    ).toThrow('1,000');
  });
  it('binds reviews to CSV metadata and requires the same rights attestation', () => {
    const first = prepareRealmCatalog(defaultConfig, csvChoice).preview;
    expect(
      prepareRealmCatalog(defaultConfig, {
        ...csvChoice,
        data: '\ufeff' + csvCatalog.replaceAll('\n', '\r\n'),
      }).preview.fingerprint,
    ).toBe(first.fingerprint);
    expect(
      prepareRealmCatalog(defaultConfig, {
        ...csvChoice,
        metadata: { ...csvMetadata, license: 'Changed rights statement' },
      }).preview.fingerprint,
    ).not.toBe(first.fingerprint);
    expect(() =>
      prepareRealmCatalog(defaultConfig, { ...csvChoice, rightsConfirmed: false }),
    ).toThrow();
    expect(() => prepareRealmCatalog(defaultConfig, { ...csvChoice, format: 'unknown' })).toThrow();
  });
  it('rejects an oversized serialized request even when CSV text fits the raw-file limit', () => {
    const categories = Array.from({ length: 20 }, () => `x${'\n'.repeat(58)}x`).join('|');
    const rows = Array.from(
      { length: 1000 },
      (_, index) =>
        `c7000000-0000-4000-8000-${String(index).padStart(12, '0')},workshop:c${index},Original,Workshop,"${categories}",`,
    );
    const data = `${header}\n${rows.join('\n')}`;
    expect(Buffer.byteLength(data)).toBeLessThan(2 * 1024 * 1024);
    expect(parseCsvCatalog(data, csvMetadata).characters).toHaveLength(1000);
    expect(() => prepareRealmCatalog(defaultConfig, { ...csvChoice, data })).toThrow('2 MiB');
  });
});
