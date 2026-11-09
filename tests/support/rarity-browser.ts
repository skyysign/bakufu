import { expect, type Browser } from '@playwright/test';
import {
  defaultConfig,
  defaultFameFloors,
  disabledFameFloors,
} from '../../packages/config/src/index';
import { createRealm, previewRealmCatalog, type Database } from '../../packages/db/src/index';
import { providerCharacterId } from '../../packages/importers/src/providers';

// Original fictional provider-shaped roster (no real names or provider data).
const roster = {
  schemaVersion: 1,
  source: 'mal',
  revision: 'original-rarity-browser-fixture',
  license: 'Original fictional provider-shaped fixture, MIT',
  characters: Array.from({ length: 200 }, (_, index) => ({
    id: providerCharacterId('mal', 930000000 + index),
    sourceKey: `mal:${930000000 + index}`,
    name: `Original Ember Warden ${index}`,
    series: `Original Hit ${index % 8}`,
    categories: ['Action', '2020s'],
    popularity: Math.round(600_000 / (index + 1)),
  })),
};

/**
 * Administration → Rarity in a real browser: an admin of a realm created
 * before fame floors reviews the recommended floors, applies them, sets one
 * character's tier by hand and returns it to automatic. Desktop and mobile.
 */
export async function verifyRarityAdmin(
  browser: Browser,
  db: Database,
  origin: string,
  admin: string,
  email: string,
  password: string,
) {
  const config = { ...defaultConfig, fameFloors: disabledFameFloors };
  const catalog = { data: roster, rightsConfirmed: true };
  const preview = await previewRealmCatalog(db, admin, config, catalog);
  const realm = await createRealm(
    db,
    admin,
    'Rarity browser fixture',
    config,
    catalog,
    preview.fingerprint,
  );
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  try {
    expect(
      (
        await context.request.post(`${origin}/api/login`, {
          headers: { Origin: origin },
          data: { email, password },
        })
      ).status(),
    ).toBe(200);
    const page = await context.newPage();
    await page.goto(`${origin}/admin?task=rarity&realm=${realm}`);
    const section = page.getByRole('region', { name: 'Rarity', exact: true });
    const rare = section.getByLabel('Rare from', { exact: true });
    await expect(rare).toHaveValue('');
    await section.getByRole('button', { name: 'Use recommended', exact: true }).click();
    await expect(rare).toHaveValue('10000');
    await expect(section.getByLabel('Legendary from', { exact: true })).toHaveValue('100000');
    await section.getByRole('button', { name: 'Review changes', exact: true }).click();
    const review = section.getByRole('region', { name: 'Review', exact: true });
    await expect(review).toContainText(/\d+ characters change tier \(\d+ up, 0 down\)/);
    await expect(review.getByRole('table', { name: 'Characters per rarity' })).toBeVisible();
    await page.screenshot({ path: '.test-data/rarity-review-desktop.png', fullPage: true });
    await review.getByRole('button', { name: 'Apply floors', exact: true }).click();
    await expect(
      section.getByRole('status').filter({ hasText: /^Fame floors applied: \d+ characters/ }),
    ).toBeVisible();
    const saved = (await db.query('SELECT config FROM realms WHERE id=$1', [realm])).rows[0].config;
    expect(saved.fameFloors).toEqual(defaultFameFloors);

    // One character by hand, then back to automatic.
    const name = 'Original Ember Warden 150';
    await section.getByLabel('Find a character', { exact: true }).fill(name);
    const matches = section.getByRole('list', { name: 'Matching characters' });
    await matches
      .getByRole('listitem')
      .filter({ hasText: name })
      .getByRole('button', { name: 'Choose', exact: true })
      .click();
    await section.getByLabel('Tier', { exact: true }).selectOption('legendary');
    await section.getByRole('button', { name: 'Save tier', exact: true }).click();
    await expect(
      section.getByRole('status').filter({ hasText: `${name} is now Legendary` }),
    ).toBeVisible();
    const manual = section.getByRole('list', { name: 'Characters with a manual tier' });
    await expect(manual).toContainText(name);

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: '.test-data/rarity-admin-mobile.png', fullPage: true });
    await manual.getByRole('button', { name: 'Back to automatic', exact: true }).click();
    await expect(
      section.getByRole('status').filter({ hasText: `${name} follows the automatic tier again` }),
    ).toBeVisible();
    await expect(section).toContainText('No character has a manual tier.');
    expect(
      (
        await db.query('SELECT count(*)::int AS count FROM tier_adjustments WHERE realm_id=$1', [
          realm,
        ])
      ).rows[0].count,
    ).toBe(3);
  } finally {
    await context.close();
  }
}
