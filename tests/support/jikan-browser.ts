import { expect, type Browser } from '@playwright/test';
import type { Database } from '../../packages/db/src/index';
import type { OpeningResult } from '../../packages/core/src/index';
import { providerCharacterId } from '../../packages/importers/src/providers';
import { chooseRealmContent, choosePack, realmWizardStep } from './screen-browser';

// Requests from the browser use original Jikan-shaped fixtures. Catalog review,
// installation, stable IDs and persistence use the real HTTP API and PostgreSQL.
export async function verifyJikanBrowser(
  browser: Browser,
  db: Database,
  origin: string,
  email: string,
  password: string,
) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const external: string[] = [],
    requests: Record<string, unknown>[] = [];
  await context.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external.push(route.request().url());
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
      works = Array.from({ length: 20 }, (_, i) => ({
        id: 910001000 + i,
        title: `Original Prism Browser Series ${i + 1}`,
        categories: ['Action', i % 2 ? 'Fantasy' : 'Sci-Fi', i < 10 ? 'Shounen' : 'Seinen'],
      }));
    let featured = false,
      limited = false;
    const additionWork = {
      id: 910009000,
      title: 'Original Lantern Addition Series',
      categories: ['Action', 'Isekai'],
    };
    await page.route('**/api/catalog/provider', async (route) => {
      const input = route.request().postDataJSON();
      requests.push(input);
      expect(input).toMatchObject({
        provider: 'jikan-api',
        service: 'tenrai',
        medium: 'anime',
        providerConsent: true,
        termsConfirmed: true,
      });
      if (input.step === 'profile') {
        // Original fixture: odd IDs are detected as female, even IDs as male.
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            kind: 'profile',
            characterId: input.characterId,
            gender: input.characterId % 2 ? 'female' : 'male',
          }),
        });
        return;
      }
      if (input.revision === 'realm-addition-1') {
        if (input.step === 'works') {
          expect(input.query).toBe('Lantern');
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ kind: 'works', works: [additionWork], page: 1, hasNextPage: false }),
          });
          return;
        }
        expect(input.work).toEqual(additionWork);
        expect(input.perWork).toBe(100);
        expect(input.artworkPermission).toBe('Original test illustration references, MIT');
        const ids = [920000000, 920000001, 930000000, 930000001, 930000002];
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            kind: 'characters',
            work: input.work,
            catalog: {
              schemaVersion: 1,
              source: 'mal',
              revision: 'realm-addition-1',
              license: 'Original Jikan-shaped browser fixture, MIT; remote references only',
              characters: ids.map((id, index) => ({
                id: providerCharacterId('mal', id),
                sourceKey: `mal:${id}`,
                name:
                  index < 2
                    ? `Original Jikan Browser Courier ${index + 1}`
                    : `Original Lantern Newcomer ${index - 1}`,
                series: additionWork.title,
                categories: additionWork.categories,
                popularity: index < 2 ? 1000 - index : 2000 - index,
                artwork: {
                  url: 'https://cdn.myanimelist.net/images/characters/fixture/original.png',
                  sourceUrl: `https://myanimelist.net/character/${id}`,
                  permission: input.artworkPermission,
                },
              })),
            },
          }),
        });
        return;
      }
      if (input.step === 'works') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ kind: 'works', works, page: 1, hasNextPage: false }),
        });
        return;
      }
      if (featured && input.work.id === works[3].id && !limited) {
        limited = true;
        await route.fulfill({
          status: 429,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Original fixture provider rate limit. Preparation paused.',
          }),
        });
        return;
      }
      const workIndex = works.findIndex((work) => work.id === input.work.id);
      expect(workIndex).toBeGreaterThanOrEqual(0);
      expect(input.artworkPermission).toBe('Original test illustration references, MIT');
      const characters = Array.from({ length: 50 }, (_, i) => {
        const id = 920000000 + workIndex * 50 + i;
        return {
          id: providerCharacterId('mal', id),
          sourceKey: `mal:${id}`,
          name: `Original Jikan Browser Courier ${workIndex * 50 + i + 1}`,
          series: works[workIndex].title,
          categories: works[workIndex].categories,
          popularity: 1000 - workIndex * 50 - i,
          artwork: {
            url: 'https://cdn.myanimelist.net/images/characters/fixture/original.png',
            sourceUrl: `https://myanimelist.net/character/${id}`,
            permission: input.artworkPermission,
          },
        };
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          kind: 'characters',
          work: input.work,
          catalog: {
            schemaVersion: 1,
            source: 'mal',
            revision: 'selected-api-1',
            license: 'Original Jikan-shaped browser fixture, MIT; remote references only',
            characters,
          },
        }),
      });
    });
    await page.goto(`${origin}/admin?task=create`);
    await page.getByLabel('Realm name', { exact: true }).fill('Original Jikan API browser fixture');
    await chooseRealmContent(page, 'provider');
    // MyAnimeList is the default roster source.
    await expect(
      page.getByRole('group', { name: 'Data source' }).getByRole('button', { name: 'MyAnimeList' }),
    ).toHaveAttribute('aria-pressed', 'true');
    const source = page.getByRole('region', { name: 'MyAnimeList browser', exact: true }),
      prepare = source.getByRole('button', { name: 'Prepare popular roster', exact: true }),
      rights = page.getByRole('checkbox', {
        name: 'I created this content and have permission to use it, or have a license for this catalog.',
        exact: true,
      }),
      previewButton = page.getByRole('button', { name: 'Preview catalog and packs', exact: true }),
      preview = page.getByRole('region', { name: 'Catalog preview', exact: true });
    await expect(prepare).toBeDisabled();
    await expect(source.getByLabel('API service', { exact: true })).toHaveValue('tenrai');
    await source.getByLabel('API service', { exact: true }).selectOption('jikan');
    await expect(
      source.getByRole('checkbox', {
        name: "Use Jikan for this setup; I reviewed the provider's usage requirements.",
        exact: true,
      }),
    ).not.toBeChecked();
    await source.getByLabel('API service', { exact: true }).selectOption('tenrai');
    await source
      .getByRole('checkbox', {
        name: "Use Tenrai for this setup; I reviewed the provider's usage requirements.",
        exact: true,
      })
      .check();
    await source
      .getByRole('checkbox', {
        name: 'Include character artwork through API, permission needed.',
        exact: true,
      })
      .check();
    await expect(prepare).toBeDisabled();
    await source
      .getByLabel('Artwork permission / permitted-use statement', { exact: true })
      .fill('Original test illustration references, MIT');
    await source.getByLabel('Find anime or manga series', { exact: true }).fill('Prism');
    await source.getByRole('button', { name: 'Browse series', exact: true }).click();
    await expect(source.getByRole('button', { name: 'Browse series', exact: true })).toBeEnabled();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ step: 'works', query: 'Prism', page: 1 });
    const chosen = source.getByRole('checkbox', { name: /^Original Prism Browser Series 1 / });
    await chosen.check();
    await source.getByRole('button', { name: 'Prepare selected series', exact: true }).click();
    await expect(source.getByRole('status')).toContainText('50 characters ready for review', {
      timeout: 90000,
    });
    // One profile lookup per character detects waifus and husbandos.
    expect(requests.filter((request) => request.step !== 'profile')).toHaveLength(2);
    expect(requests.filter((request) => request.step === 'profile')).toHaveLength(50);
    await rights.check();
    await previewButton.click();
    await expect(preview).toContainText('50 characters;');
    await expect(preview).toContainText('Waifus');
    await expect(preview).toContainText('Husbandos');
    await realmWizardStep(page, 'Characters');
    await chosen.uncheck();
    await expect(preview).toHaveCount(0);
    await expect(rights).not.toBeChecked();
    // The large roster skips the profile check to keep this test quick.
    await source.getByRole('checkbox', { name: /^Detect waifus & husbandos/ }).uncheck();
    featured = true;
    await prepare.click();
    await expect(source.getByRole('status')).toContainText('150 characters retained', {
      timeout: 15000,
    });
    expect(limited).toBe(true);
    const pausedRequests = requests.length;
    await page.waitForTimeout(1500);
    expect(requests).toHaveLength(pausedRequests);
    await expect(
      source.getByRole('button', { name: 'Download prepared catalog', exact: true }),
    ).toBeVisible();
    await source.getByRole('button', { name: 'Resume preparation', exact: true }).click();
    await expect(source.getByRole('status')).toContainText(
      /1\D?000 characters ready for review\./,
      { timeout: 40000 },
    );
    expect(requests.filter((request) => request.step === 'works')).toHaveLength(2);
    expect(requests.filter((request) => request.step === 'characters')).toHaveLength(22);
    await rights.check();
    await previewButton.click();
    await expect(preview).toContainText('1000 characters;');
    await expect(preview).toContainText('Authorized Jikan / MAL character metadata');
    await page.screenshot({ path: '.test-data/jikan-api-prepared-desktop.png' });
    await realmWizardStep(page, 'Review');
    await page.getByRole('button', { name: 'Create realm', exact: true }).click();
    await page.waitForURL((url) => url.pathname === '/packs' && url.searchParams.has('realm'));
    const realm = new URL(page.url()).searchParams.get('realm')!;
    const saved = await db.query(
      "SELECT count(*)::integer AS count,count(*) FILTER(WHERE provenance->'artwork'->>'permission'=$2)::integer AS artwork FROM characters WHERE realm_id=$1",
      [realm, 'Original test illustration references, MIT'],
    );
    expect(saved.rows[0]).toEqual({ count: 1000, artwork: 1000 });
    // Actual demographic metadata creates different character pools. Distinct
    // genres add variety as their own honestly named packs; Action covers the
    // whole roster, so it would only repeat All Characters and is skipped.
    const packs = (
      await db.query('SELECT name,category FROM packs WHERE realm_id=$1 ORDER BY name', [realm])
    ).rows;
    expect(packs).toEqual([
      { name: 'All Characters', category: null },
      { name: 'Fantasy Realms', category: 'Fantasy' },
      { name: 'Future City', category: 'Sci-Fi' },
      { name: 'Seinen', category: 'Seinen' },
      { name: 'Shōnen', category: 'Shounen' },
    ]);
    await expect(page.locator('.pack')).toHaveCount(5);
    const shonen = page.locator('.pack').filter({
      has: page.getByRole('link', { name: 'Explore Shōnen', exact: true }),
    });
    const seinen = page.locator('.pack').filter({
      has: page.getByRole('link', { name: 'Explore Seinen', exact: true }),
    });
    await expect(shonen).toBeVisible();
    await expect(seinen).toBeVisible();
    await expect(page.locator('.discovery-pack-grid .portrait-frame')).toHaveCount(0);
    await expect(page.locator('.discovery-pack-grid')).not.toContainText(/lantern atlas/i);
    await shonen.getByLabel('Pack information for Shōnen', { exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(shonen.locator('.pack-insight-content')).toContainText('Pool: Shounen');
    await expect(shonen.locator('.pack-insight-content')).toContainText('500 unclaimed');
    await page.keyboard.press('Escape');
    await seinen.getByLabel('Pack information for Seinen', { exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(seinen.locator('.pack-insight-content')).toContainText('500 unclaimed');
    await page.keyboard.press('Escape');
    await page.getByRole('searchbox', { name: 'Search packs', exact: true }).fill('Shōnen');
    await expect(page.locator('.pack')).toHaveCount(1);
    await expect(shonen).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search packs', exact: true }).fill('');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.pack-catalog').screenshot({
      path: '.test-data/demographic-packs-desktop.png',
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.locator('.discovery-pack-grid').screenshot({
      path: '.test-data/demographic-packs-mobile.png',
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    const detail = await choosePack(page, 'Shōnen');
    await expect(detail.locator('.illustrated-pack')).not.toContainText(/lantern atlas/i);
    await expect(detail.locator('.portrait-frame')).toHaveCount(0);
    await page.screenshot({ path: '.test-data/demographic-opening-room-desktop.png' });
    const opened = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/open' && response.request().method() === 'POST',
    );
    await detail.getByRole('button', { name: /Open pack/ }).click();
    const response = await opened;
    expect(response.status()).toBe(200);
    const result = (await response.json()) as OpeningResult;
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Original demographic opening fixture failed.');
    expect(result.characters.length).toBeGreaterThan(0);
    expect(result.characters.every((character) => character.categories.includes('Shounen'))).toBe(
      true,
    );
    const reveal = page.getByRole('region', { name: 'Pack reveal: Shōnen', exact: true });
    await expect(reveal).toBeVisible();
    await expect(
      reveal.getByRole('heading', { name: 'Your pack contents', exact: true }),
    ).toBeVisible();
    // The Packs page tracker lists the card that was just pulled.
    await page.goto(`${origin}/packs?realm=${realm}`);
    const live = page.getByRole('region', { name: 'Live pulls', exact: true });
    // Only rare and above are listed; the tracker sits below the pack grid.
    const notable = result.characters.filter((character) =>
      ['rare', 'epic', 'legendary'].includes(character.tier),
    );
    expect(
      await page.evaluate(() => {
        const packs = document.querySelector('.pack-catalog'),
          tracker = document.querySelector('.pull-tracker');
        return !!packs && !!tracker && !!(packs.compareDocumentPosition(tracker) & 4);
      }),
    ).toBe(true);
    if (notable.length) {
      const first = live.locator('.pull-item').first();
      await expect(first).toContainText(notable.at(-1)!.name);
      await expect(first).toContainText('You');
      await first.getByRole('button', { name: `Inspect ${notable.at(-1)!.name}` }).click();
      const details = page.getByRole('dialog', { name: `${notable.at(-1)!.name} card details` });
      await expect(details).toBeVisible();
      await details.getByRole('button', { name: 'Close card inspection' }).click();
      await expect(details).toBeHidden();
    } else await expect(live).toContainText('No big pulls yet');
    expect(
      await live.evaluate((section) => {
        const grid = section.querySelector('.pull-grid');
        return !grid || grid.scrollWidth <= grid.clientWidth;
      }),
    ).toBe(true);
    // Administration → Characters: look up one series and add only its missing cast.
    const lookupsBefore = requests.length;
    await page.goto(`${origin}/admin?task=characters&realm=${realm}`);
    const section = page.getByRole('region', { name: 'Characters', exact: true });
    await expect(section).toContainText(/1.?000 characters · 1.?000 with artwork/);
    await expect(
      section.getByRole('checkbox', {
        name: 'Include character artwork through API, permission needed.',
        exact: true,
      }),
    ).toBeChecked();
    await expect(
      section.getByLabel('Artwork permission / permitted-use statement', { exact: true }),
    ).toHaveValue('Original test illustration references, MIT');
    const searchSeries = section.getByRole('button', { name: 'Search series', exact: true });
    await expect(searchSeries).toBeDisabled();
    await section
      .getByRole('checkbox', {
        name: 'Use Tenrai for this lookup; I reviewed its usage requirements and may use this metadata.',
        exact: true,
      })
      .check();
    await section.getByLabel('Series name', { exact: true }).fill('Lantern');
    await searchSeries.click();
    await section.getByRole('button', { name: /^Original Lantern Addition Series/ }).click();
    const cast = section.getByRole('group', { name: /^Original Lantern Addition Series/ });
    await expect(cast).toContainText('5 characters · 3 not in this realm yet');
    await expect(cast.getByText('Already in this realm', { exact: true })).toHaveCount(2);
    await expect(
      cast.getByRole('checkbox', { name: /Original Jikan Browser Courier 1/ }),
    ).toBeDisabled();
    await cast.getByRole('checkbox', { name: /Original Lantern Newcomer 3/ }).uncheck();
    await cast.getByRole('button', { name: 'Add 2 characters', exact: true }).click();
    await expect(section.getByRole('status').filter({ hasText: 'Added 2 characters' })).toContainText(
      'Original Lantern Newcomer 1',
    );
    await expect(section).toContainText('New in this realm: Isekai');
    await expect(cast).toContainText('1 not in this realm yet');
    expect(requests.length - lookupsBefore).toBe(2);
    const additions = await db.query(
      `SELECT source_key,tier,provenance->'artwork'->>'permission' AS permission,provenance->>'importKind' AS kind
      FROM characters WHERE realm_id=$1 AND source_key LIKE 'mal:93000000%' ORDER BY source_key`,
      [realm],
    );
    expect(additions.rows).toEqual([
      {
        source_key: 'mal:930000000',
        tier: 'legendary',
        permission: 'Original test illustration references, MIT',
        kind: 'mal-addition-v1',
      },
      {
        source_key: 'mal:930000001',
        tier: 'legendary',
        permission: 'Original test illustration references, MIT',
        kind: 'mal-addition-v1',
      },
    ]);
    expect(external.filter((url) => !url.startsWith('https://cdn.myanimelist.net/'))).toEqual([]);
    // Provider-hosted art requests are blocked here; the separate batch fixture
    // supplies original image bytes and checks actual rendering/fallback behavior.
  } finally {
    await context.close();
  }
}
