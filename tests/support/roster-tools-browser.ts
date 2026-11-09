import { expect, type Browser } from '@playwright/test';
import { defaultConfig } from '../../packages/config/src/index';
import {
  createRealm,
  getRealmView,
  previewRealmCatalog,
  type Database,
} from '../../packages/db/src/index';
import { providerCharacterId } from '../../packages/importers/src/providers';

// Original fictional provider-shaped roster: odd characters have no picture.
const entry = (index: number) => ({
  id: providerCharacterId('mal', 970000000 + index),
  sourceKey: `mal:${970000000 + index}`,
  name: `Original Harbor Scout ${index}`,
  series: `Original Voyage ${index % 4}`,
  categories: ['Action', '2020s'],
  popularity: 400 - index,
  ...(index % 2 === 0
    ? {
        artwork: {
          url: `https://cdn.myanimelist.net/images/characters/1/original-scout-${index}.jpg`,
          sourceUrl: `https://myanimelist.net/character/${970000000 + index}`,
          permission: 'Original fixture permission statement',
        },
      }
    : {}),
});
const roster = {
  schemaVersion: 1,
  source: 'mal',
  revision: 'original-roster-tools-fixture',
  license: 'Original fictional provider-shaped fixture, MIT',
  characters: Array.from({ length: 40 }, (_, index) => entry(index)),
};

async function signIn(browser: Browser, origin: string, email: string, password: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  // No request may leave the test server (provider lookups are answered below).
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  expect(
    (
      await context.request.post(`${origin}/api/login`, {
        headers: { Origin: origin },
        data: { email, password },
      })
    ).status(),
  ).toBe(200);
  return context;
}

/**
 * Opening window recycling, growing a MyAnimeList roster after creation, and
 * removing characters, in a real browser.
 */
export async function verifyRosterTools(
  browser: Browser,
  db: Database,
  origin: string,
  admin: string,
  email: string,
  password: string,
) {
  // Only commons can be drawn, so a 5-pack opening has five commons.
  const config = {
    ...defaultConfig,
    startingGems: 5_000,
    tierWeights: { common: 10_000, uncommon: 0, rare: 0, epic: 0, legendary: 0 },
  };
  const catalog = { data: roster, rightsConfirmed: true };
  const preview = await previewRealmCatalog(db, admin, config, catalog);
  const realm = await createRealm(
    db,
    admin,
    'Roster tools browser fixture',
    config,
    catalog,
    preview.fingerprint,
  );
  const pack = (await getRealmView(db, admin, realm)).packs.find(
    (item) => item.name === 'All Characters',
  )!;
  const context = await signIn(browser, origin, email, password);
  try {
    const page = await context.newPage();
    // Reduced motion opens straight onto the results.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${origin}/packs?realm=${realm}&pack=${pack.id}`);
    const detail = page.locator('.pack-detail');
    await page
      .getByRole('group', { name: 'Packs per opening' })
      .getByRole('button', { name: '5 packs', exact: true })
      .click();
    await detail.getByRole('button', { name: /Open 5 packs/ }).click();
    const reveal = page.getByRole('region', { name: 'Pack reveal: All Characters' });
    await expect(reveal.locator('.reveal-card')).toHaveCount(5);
    const before = (await getRealmView(db, admin, realm)).balance;

    // One card by itself, then the other four with the bulk button.
    const first = reveal.locator('.reveal-card').first();
    await first.getByRole('button', { name: /^Recycle Original Harbor Scout/ }).click();
    await expect(first.locator('.reveal-recycled')).toContainText('Recycled +');
    const bulk = reveal.getByRole('group', { name: 'Recycle by rarity' });
    await bulk.getByRole('button', { name: /Recycle all common \(4\)/ }).click();
    await bulk.getByRole('button', { name: /^Confirm: recycle 4 for \+/ }).click();
    await expect(
      reveal.getByRole('status').filter({ hasText: /4 common cards recycled/ }),
    ).toBeVisible();
    await expect(reveal.locator('.reveal-recycled')).toHaveCount(5);
    await expect(bulk).toHaveCount(0);
    const after = await getRealmView(db, admin, realm);
    expect(after.cards).toHaveLength(0);
    expect(after.balance).toBeGreaterThan(before);
    await page.screenshot({ path: '.test-data/opening-recycle-desktop.png' });

    // Grow the roster: two popular series answered by a fixture, 12 new characters.
    const mediums: string[] = [];
    await page.route('**/api/catalog/provider', async (route) => {
      const body = route.request().postDataJSON();
      mediums.push(body.medium);
      const works = [0, 1].map((i) => ({
        id: 980000000 + i,
        title: `Original Long Voyage ${i}`,
        categories: ['Adventure'],
      }));
      await route.fulfill({
        json:
          body.step === 'works'
            ? { kind: 'works', medium: body.medium, page: body.page, hasNextPage: false, works }
            : {
                kind: 'characters',
                medium: body.medium,
                work: body.work,
                catalog: {
                  schemaVersion: 1,
                  source: 'mal',
                  revision: 'realm-growth-1',
                  license: 'Original fixture',
                  characters: Array.from({ length: 8 }, (_, i) => {
                    const id = body.work.id * 10 + i;
                    return {
                      id: providerCharacterId('mal', id),
                      sourceKey: `mal:${id}`,
                      name: `Original Deckhand ${id}`,
                      series: body.work.title,
                      categories: body.work.categories,
                      popularity: 50 - i,
                    };
                  }),
                },
              },
      });
    });
    await page.goto(`${origin}/admin?task=characters&realm=${realm}`);
    await page.getByRole('checkbox', { name: /^Use Tenrai for this lookup/ }).check();
    const growth = page.getByRole('region', { name: 'Grow the roster', exact: true });
    await growth.getByRole('checkbox', { name: 'Manhwa (Korean)', exact: true }).check();
    await growth.getByLabel('Exact number of characters to add', { exact: true }).fill('12');
    await growth.getByLabel('Characters per series', { exact: true }).selectOption('10');
    await growth.getByRole('button', { name: 'Add up to 12 characters', exact: true }).click();
    await expect(growth.getByRole('status')).toContainText('Done: 12 characters added', {
      timeout: 30_000,
    });
    expect(new Set(mediums).size).toBeGreaterThanOrEqual(1);
    expect(mediums.every((medium) => ['anime', 'manhwa'].includes(medium))).toBe(true);
    const grown = (
      await db.query(
        "SELECT count(*)::int AS count FROM characters WHERE realm_id=$1 AND source_key LIKE 'mal:98%'",
        [realm],
      )
    ).rows[0].count;
    expect(grown).toBe(12);
    await page.unroute('**/api/catalog/provider');

    // Remove every character without a picture (20 original + 12 new).
    const removal = page.getByRole('region', { name: 'Remove characters', exact: true });
    await expect(removal).toContainText('32 characters have no picture.');
    await removal
      .getByRole('button', { name: 'Remove all without a picture…', exact: true })
      .click();
    const review = removal.getByRole('group', { name: 'Review removal' });
    await expect(review).toContainText('Remove 32 characters');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: '.test-data/character-removal-mobile.png', fullPage: true });
    await review.getByRole('button', { name: 'Remove 32 characters', exact: true }).click();
    await expect(removal.getByRole('status')).toContainText('Removed 32 characters.');
    await expect(removal).toContainText('Every character has a picture.');
    expect(
      (
        await db.query(
          'SELECT count(*)::int AS count FROM characters WHERE realm_id=$1 AND retired_at IS NOT NULL',
          [realm],
        )
      ).rows[0].count,
    ).toBe(32);
  } finally {
    await context.close();
  }
}
