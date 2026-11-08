import { fileURLToPath } from 'node:url';
import { expect, type Browser } from '@playwright/test';
import type { Database } from '../../packages/db/src/index';
import { defaultPackName } from '../../packages/core/src/index';
import { chooseRealmContent, realmWizardStep } from './screen-browser';
import {
  providerCharacterId,
  majorCatalogCategories,
} from '../../packages/importers/src/providers';

// Only external metadata is replaced. Preparation review/installation use the
// real application API and a disposable PostgreSQL database.
export async function verifyProviderPipeline(
  browser: Browser,
  db: Database,
  origin: string,
  email: string,
  password: string,
) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    external: string[] = [];
  await context.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external.push(new URL(route.request().url()).origin);
    return route.abort();
  });
  try {
    expect(
      (
        await context.request.post(`${origin}/api/login`, {
          headers: { Origin: origin },
          data: { email, password },
        })
      ).status(),
    ).toBe(200);
    const page = await context.newPage(),
      ids = [910000001, 910000002],
      requests: Record<string, unknown>[] = [];
    const catalog = {
      schemaVersion: 1,
      source: 'anilist',
      revision: 'selection-1',
      license: 'Original AniList-shape metadata fixture, MIT; excludes artwork',
      characters: ids.map((id, index) => ({
        id: providerCharacterId('anilist', id),
        sourceKey: `anilist:${id}`,
        name: `Original Provider Browser Courier ${index + 1}`,
        series: 'Original Prism Academy',
        categories: ['Action', 'Fantasy'],
        popularity: 100 - index,
      })),
    };
    await page.route('**/api/catalog/provider', async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(catalog),
      });
    });
    await page.goto(`${origin}/admin?task=create`);
    await page.getByLabel('Realm name', { exact: true }).fill('Selected provider browser fixture');
    await chooseRealmContent(page, 'provider');
    await page
      .getByRole('group', { name: 'Data source' })
      .getByRole('button', { name: 'Other formats', exact: true })
      .click();
    await expect(page.getByRole('group', { name: 'Provider format', exact: true })).toBeVisible();
    await page.getByLabel('Provider medium', { exact: true }).selectOption('anime');
    await page.getByLabel('Selected AniList character IDs', { exact: true }).fill(ids.join(', '));
    const prepare = page.getByRole('button', { name: 'Prepare provider catalog', exact: true });
    await expect(prepare).toBeDisabled();
    await page
      .getByRole('checkbox', {
        name: "I reviewed the provider's terms and have permission to use this selected metadata.",
        exact: true,
      })
      .check();
    await page
      .getByRole('checkbox', { name: 'Send these selected IDs to AniList.', exact: true })
      .check();
    await prepare.click();
    await expect.poll(() => requests.length).toBe(1);
    await expect(prepare).toBeEnabled();
    expect(requests[0]).toEqual({
      provider: 'anilist',
      medium: 'anime',
      revision: 'selection-1',
      providerConsent: true,
      termsConfirmed: true,
      ids,
    });
    const rights = page.getByRole('checkbox', {
      name: 'I created this content and have permission to use it, or have a license for this catalog.',
      exact: true,
    });
    const previewButton = page.getByRole('button', {
      name: 'Preview catalog and packs',
      exact: true,
    });
    await expect(previewButton).toBeDisabled();
    await rights.check();
    await expect(previewButton).toBeEnabled();
    await previewButton.click();
    const preview = page.getByRole('region', { name: 'Catalog preview', exact: true });
    await expect(preview).toContainText('Selected AniList character metadata');
    await expect(preview).toContainText('2 characters;');
    // A provider roster without artwork says so before the realm is created.
    await expect(preview.getByRole('note')).toContainText('These characters have no pictures');
    // Genre-only provider metadata must not masquerade as a demographic pool.
    await expect(preview).toContainText('All Characters');
    await expect(preview).not.toContainText(defaultPackName('Action'));
    // Editing a selected provider invalidates its loaded proposal and permission.
    await realmWizardStep(page, 'Characters');
    await page.getByLabel('Selected AniList character IDs', { exact: true }).fill(ids.join(' '));
    await expect(preview).toHaveCount(0);
    await expect(rights).not.toBeChecked();
    await rights.check();
    await expect(previewButton).toBeDisabled();
    await prepare.click();
    await expect.poll(() => requests.length).toBe(2);
    await expect(prepare).toBeEnabled();
    await expect(rights).not.toBeChecked();
    await rights.check();
    await expect(previewButton).toBeEnabled();
    await previewButton.click();
    await expect(preview).toContainText('2 characters;');
    await realmWizardStep(page, 'Review');
    const created = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/realms' &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Create realm', exact: true }).click();
    expect((await created).status()).toBe(201);
    await page.waitForURL((url) => url.pathname === '/packs' && url.searchParams.has('realm'));
    const providerRealm = new URL(page.url()).searchParams.get('realm')!;
    const installed = (
      await db.query(
        'SELECT source_key,name,categories,provenance FROM characters WHERE realm_id=$1 ORDER BY source_key',
        [providerRealm],
      )
    ).rows;
    expect(installed).toHaveLength(2);
    for (const [index, row] of installed.entries()) {
      expect(row).toMatchObject({
        source_key: catalog.characters[index].sourceKey,
        name: catalog.characters[index].name,
        categories: ['Action', 'Fantasy'],
        provenance: { source: 'anilist', revision: 'selection-1', rightsConfirmed: true },
      });
    }
    expect(JSON.stringify(installed)).not.toContain('images');
    await expect(page.locator('#market')).toHaveCount(0);
    await expect(page.locator('#collection')).toHaveCount(0);
    await expect(page.locator('.pack')).toHaveCount(1);
    await expect(
      page.getByRole('link', { name: 'Explore All Characters', exact: true }),
    ).toBeVisible();
    // The downloadable original test catalog goes through upload, review and install.
    await page.goto(`${origin}/admin?realm=${providerRealm}&task=create`);
    await page
      .getByLabel('Realm name', { exact: true })
      .fill('Original 1000-character browser fixture');
    await chooseRealmContent(page, 'custom');
    const example = page.getByRole('link', { name: '1,000-character test catalog', exact: true });
    await expect(example).toHaveAttribute('href', '/catalog-scale.v1.json');
    await expect(
      page.getByRole('link', { name: '12-character demo catalog', exact: true }),
    ).toHaveAttribute('href', '/catalog-demo.v1.json');
    await page
      .getByLabel('Original catalog JSON file', { exact: true })
      .setInputFiles(fileURLToPath(new URL('../../apps/web/public/catalog-scale.v1.json', import.meta.url)));
    await rights.check();
    await expect(previewButton).toBeEnabled();
    await previewButton.click();
    await expect(preview).toContainText('1000 characters; 11 starter packs');
    await expect(preview).toContainText('Common: 600; uncommon: 280; rare: 90');
    await expect(preview).toContainText('epic: 25; legendary: 5');
    const packRows = preview.getByRole('region', { name: 'Starter pack preview' }).getByRole('row');
    await expect(packRows).toHaveCount(12);
    await realmWizardStep(page, 'Review');
    const scaleCreation = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/realms' &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Create realm', exact: true }).click();
    expect((await scaleCreation).status()).toBe(201);
    await page.waitForURL(
      (url) => url.pathname === '/packs' && url.searchParams.get('realm') !== providerRealm,
    );
    const scaleRealm = new URL(page.url()).searchParams.get('realm')!;
    expect(
      (
        await db.query('SELECT count(*)::integer AS count FROM characters WHERE realm_id=$1', [
          scaleRealm,
        ])
      ).rows[0].count,
    ).toBe(1000);
    const packs = (
      await db.query('SELECT name,category FROM packs WHERE realm_id=$1 ORDER BY name', [
        scaleRealm,
      ])
    ).rows;
    expect(packs).toHaveLength(11);
    for (const pack of packs.filter((item) => item.category !== null)) {
      expect(majorCatalogCategories).toContain(pack.category);
      expect(pack.name).toBe(defaultPackName(pack.category));
    }
    await expect(page.locator('.pack')).toHaveCount(11);
    await expect(page.locator('#collection')).toHaveCount(0);
    await expect(page.locator('#trades')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Collector ranks' })).toHaveCount(0);
    await expect(
      page
        .getByRole('navigation', { name: 'Main navigation' })
        .getByRole('link', { name: 'Packs', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    expect(external).toEqual([]);
  } finally {
    await context.close();
  }
}
