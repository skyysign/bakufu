import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect, type Browser } from '@playwright/test';
import { defaultConfig } from '../../packages/config/src/index';
import {
  createRealm,
  getRealmView,
  loginDiscord,
  openPack,
  previewRealmCatalog,
  type Database,
} from '../../packages/db/src/index';
import { catalogSchema } from '../../packages/importers/src/json';
import { choosePack, showScreen } from './screen-browser';
import { assertTradingCardFaces } from './reveal-gallery';

// Real HTTP and transactions with an original thousand-character catalog.
// Public avatar image bytes are also an original fixture; all other external
// requests are rejected so this check never contacts a provider.
export async function verifyCollectionExperience(
  browser: Browser,
  db: Database,
  origin: string,
  admin: string,
  email: string,
  password: string,
) {
  const catalog = catalogSchema.parse(
    JSON.parse(
      readFileSync(new URL('../../apps/web/public/catalog-scale.v1.json', import.meta.url), 'utf8'),
    ),
  );
  const config = { ...defaultConfig, startingGems: 50000 };
  const choice = { data: catalog, rightsConfirmed: true };
  const preview = await previewRealmCatalog(db, admin, config, choice);
  const realm = await createRealm(
    db,
    admin,
    'Original collection experience',
    config,
    choice,
    preview.fingerprint,
  );
  const original = await getRealmView(db, admin, realm);
  const all = original.packs.find((pack) => pack.name === 'All Characters')!;
  const opening = await openPack(db, admin, realm, all.id, randomUUID(), undefined, 10);
  if (!opening.ok) throw new Error('Original collection fixture did not open.');
  const expectedWallet = (await getRealmView(db, admin, realm)).balance;
  const avatar =
    'https://cdn.discordapp.com/avatars/100000000000000001/0123456789abcdef0123456789abcdef.png?size=128';
  const brokenAvatar = avatar.replace(
    '0123456789abcdef0123456789abcdef',
    'ffffffffffffffffffffffffffffffff',
  );
  await loginDiscord(db, '100000000000000001', undefined, {
    username: 'atlas_admin',
    displayName: 'Atlas Admin',
    avatarUrl: avatar,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const external: string[] = [],
    errors: Error[] = [];
  let avatarRequests = 0;
  await context.route('**/*', (route) => {
    const request = route.request(),
      url = request.url();
    if (url === brokenAvatar) return route.abort('failed');
    if (url === avatar) {
      avatarRequests++;
      expect(request.headers()['referer']).toBeUndefined();
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#7352a6"/><circle cx="40" cy="30" r="15" fill="#efc4ae"/><path d="M10 80V65q0-22 30-22t30 22v15" fill="#252741"/></svg>',
      });
    }
    if (new URL(url).origin === origin) return route.continue();
    external.push(url);
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
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error));
    await page.goto(`${origin}/packs?realm=${realm}`);
    await expect(page.locator('.game-header .brand')).toHaveAttribute(
      'href',
      `/packs?realm=${realm}`,
    );
    await expect(page.getByLabel('Choose realm', { exact: true })).toHaveCount(0);
    await expect(page.locator('.realm-bar')).toHaveCount(0);
    await expect(page.locator('.header-player .discord-avatar img')).toHaveAttribute('src', avatar);
    await expect
      .poll(() =>
        page
          .locator('.header-player .discord-avatar img')
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    const angles = await page.locator('.spotlight-card').evaluateAll((cards) =>
      cards.map((card) => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(card).transform);
        return Math.abs(matrix.b) < 0.001 && Math.abs(matrix.c) < 0.001;
      }),
    );
    expect(angles.length).toBeGreaterThan(0);
    expect(angles.every(Boolean)).toBe(true);
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await showScreen(page, 'collection');
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await expect(page.locator('#collection .character')).toHaveCount(10);
    await assertTradingCardFaces(page.locator('#collection .card-face'));
    await expect(page.getByLabel('Choose realm', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: '.test-data/physical-collection-desktop.png' });
    const firstCard = (await getRealmView(db, admin, realm)).cards[0];
    const inspectCollection = page.getByRole('button', {
      name: `Inspect ${firstCard.name}`,
      exact: true,
    });
    await inspectCollection.click();
    const inspection = page.getByRole('dialog', {
      name: `${firstCard.name} card details`,
      exact: true,
    });
    await expect(inspection).toBeVisible();
    await expect(
      inspection.getByRole('heading', { name: firstCard.name, level: 2, exact: true }),
    ).toBeVisible();
    await expect(
      inspection.getByRole('button', { name: 'Close card inspection', exact: true }),
    ).toBeFocused();
    await expect(inspection).toContainText('Saved source popularity');
    await assertTradingCardFaces(inspection.locator('.card-face'));
    await page.screenshot({ path: '.test-data/card-inspection-desktop.png' });
    await page.keyboard.press('Escape');
    await expect(inspection).toHaveCount(0);
    await expect(inspectCollection).toBeFocused();
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await page.locator('.game-header .brand').click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/packs');
    expect(new URL(page.url()).searchParams.get('realm')).toBe(realm);
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await showScreen(page, 'account');
    await expect(page.getByLabel('Choose realm', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Choose realm', { exact: true })).toHaveValue(realm);
    await showScreen(page, 'wishlist');
    await expect(page.getByLabel('Choose realm', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: /^Character glossary/ }).click();
    const glossary = page.locator('.glossary-grid');
    await expect(glossary.locator('article')).toHaveCount(24);
    await assertTradingCardFaces(glossary.locator('.card-face'));
    const palette = await glossary.locator('.card-face').evaluateAll((faces) =>
      faces.map((face) => ({
        tier: Array.from(face.classList).find((name) => name !== 'card-face'),
        colour: getComputedStyle(face).borderTopColor,
      })),
    );
    expect(new Set(palette.map((entry) => entry.tier)).size).toBeGreaterThan(1);
    expect(new Set(palette.map((entry) => entry.colour)).size).toBe(
      new Set(palette.map((entry) => entry.tier)).size,
    );
    await expect(page.locator('.card-browser-count')).toContainText(/1\D?000 characters/);
    const commonValues = original.catalog
      .filter((card) => card.tier === 'common')
      .map((card) => original.characterValues[card.id].marketValue);
    expect(new Set(commonValues).size).toBeGreaterThan(1);
    await page.screenshot({ path: '.test-data/character-glossary-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await assertTradingCardFaces(glossary.locator('.card-face'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: '.test-data/character-glossary-mobile.png' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    const firstName = await glossary.locator('h3').first().textContent();
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(page.locator('.card-browser-count')).toContainText('Page 2 of 42');
    expect(await glossary.locator('h3').first().textContent()).not.toBe(firstName);
    const owned = (await getRealmView(db, admin, realm)).cards;
    await page.getByLabel('Filter character ownership').selectOption('yours');
    await expect(glossary.locator('article')).toHaveCount(10);
    await page.getByLabel('Filter character ownership').selectOption('all');
    await page.getByLabel('Filter glossary rarity').selectOption('legendary');
    const legendary = original.catalog.filter((card) => card.tier === 'legendary');
    expect(legendary.length).toBeGreaterThan(0);
    await expect(glossary.locator('article')).toHaveCount(Math.min(24, legendary.length));
    await page.getByLabel('Filter glossary rarity').selectOption('all');
    const wished = original.catalog.find((card) => !owned.some((entry) => entry.id === card.id))!;
    const beforeWish = (await getRealmView(db, admin, realm)).characterValues[wished.id];
    await page.getByLabel('Search character glossary').fill(wished.name);
    await expect(glossary.locator('article')).toHaveCount(1);
    await expect(glossary.getByRole('heading', { name: wished.name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^Your wishlist/ }).click();
    // The browser offers as many picks as there are free slots.
    const freeSlots = (await getRealmView(db, admin, realm)).effectiveWishlistSlots;
    await page
      .getByRole('button', {
        name: `Browse characters (${freeSlots} free ${freeSlots === 1 ? 'slot' : 'slots'})`,
        exact: true,
      })
      .click();
    const picker = page.getByRole('dialog', { name: 'Choose wishlist characters', exact: true });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole('status')).toContainText(`0 / ${freeSlots} selected`);
    await picker.getByLabel('Search cards by name or series').fill(wished.name);
    await picker.getByRole('button', { name: `Select ${wished.name}`, exact: true }).click();
    await picker.getByLabel('Search cards by name or series').fill('no matching character');
    await expect(picker).toContainText('No characters match your search');
    await picker.getByLabel('Search cards by name or series').fill(wished.name);
    await expect(
      picker.getByRole('button', { name: `Select ${wished.name}`, exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    // A second character in the same pick: both are added together.
    const second = original.catalog.find(
      (card) => card.id !== wished.id && !owned.some((entry) => entry.id === card.id),
    )!;
    await picker.getByLabel('Search cards by name or series').fill(second.name);
    await picker.getByRole('button', { name: `Select ${second.name}`, exact: true }).click();
    await picker.getByRole('button', { name: 'Add 2 to wishlist', exact: true }).click();
    await expect
      .poll(async () =>
        (await getRealmView(db, admin, realm)).wishlist.map((card) => card.id).sort(),
      )
      .toEqual([wished.id, second.id].sort());
    await expect(page.getByRole('status').filter({ hasText: '2 characters added' })).toBeVisible();
    // Keep the rest of this check on one wish.
    await page
      .getByRole('button', { name: new RegExp(`^Remove ${second.name}`) })
      .first()
      .click();
    await expect
      .poll(async () => (await getRealmView(db, admin, realm)).wishlist.map((card) => card.id))
      .toEqual([wished.id]);
    await expect(page.locator('.wishlist-character')).toHaveCount(1);
    const wishedValue = (await getRealmView(db, admin, realm)).characterValues[wished.id];
    expect(wishedValue.wishlistDemand).toBe(beforeWish.wishlistDemand + 1);
    expect(wishedValue.marketValue).toBeGreaterThan(beforeWish.marketValue);
    await showScreen(page, 'trades');
    await page.getByRole('button', { name: 'New trade', exact: true }).click();
    // Any valid trade ID opens both sides; the partner's own cards then fail to load.
    await page
      .getByLabel('Other player’s trade ID', { exact: true })
      .fill('00000000-0000-4000-8000-000000000001');
    const give = page.getByRole('region', { name: 'You give', exact: true });
    await give.getByRole('button', { name: /^Choose cards/ }).click();
    const tradePicker = page.getByRole('dialog', { name: 'Choose cards to give', exact: true });
    await assertTradingCardFaces(tradePicker.locator('.card-face'));
    await page.screenshot({ path: '.test-data/trade-card-picker-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: '.test-data/trade-card-picker-mobile.png' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const card of owned.slice(0, 2)) {
      await tradePicker.getByLabel('Search cards by name or series').fill(card.name);
      await tradePicker.getByRole('button', { name: `Select ${card.name}`, exact: true }).click();
    }
    await tradePicker.getByRole('button', { name: 'Use 2 selected cards', exact: true }).click();
    for (const card of owned.slice(0, 2))
      await expect(
        give.getByRole('button', { name: `Remove ${card.name}`, exact: true }),
      ).toBeVisible();
    await give.getByRole('button', { name: /^Choose cards/ }).click();
    await tradePicker.getByLabel('Search cards by name or series').fill(owned[0].name);
    await expect(
      tradePicker.getByRole('button', { name: `Select ${owned[0].name}`, exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await tradePicker.getByLabel('Search cards by name or series').focus();
    await page.keyboard.press('Enter');
    expect((await getRealmView(db, admin, realm)).trades).toHaveLength(0);
    await page.keyboard.press('Escape');
    await expect(tradePicker).not.toBeVisible();
    expect((await getRealmView(db, admin, realm)).balance).toBe(expectedWallet);
    await showScreen(page, 'ranks');
    const ranks = page.getByRole('region', { name: 'Collector ranks', exact: true });
    const bronze = ranks.locator('[data-rank-track="bronze"]');
    await expect(ranks.locator('[data-rank-track]')).toHaveCount(6);
    await expect(ranks.locator('[data-rank-track="sapphire"]')).toContainText('Bronze');
    await expect(ranks.locator('[data-rank-track="sapphire"]').getByRole('button')).toBeDisabled();
    await expect(page.getByRole('region', { name: 'Pack upgrades', exact: true })).toHaveCount(0);
    await page.screenshot({ path: '.test-data/collector-ranks-desktop.png', fullPage: true });
    const rankRequests: unknown[] = [];
    await page.route('**/api/ranks/track', async (route) => {
      rankRequests.push(route.request().postDataJSON());
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (rankRequests.length === 1) await route.abort('failed');
      else await route.fulfill({ response });
    });
    await bronze.getByRole('button', { name: 'Upgrade Bronze to level 1', exact: true }).click();
    await ranks.getByRole('button', { name: /Retry/ }).click();
    await expect(ranks.getByRole('status')).toContainText('Bronze level 1 unlocked');
    expect(rankRequests).toHaveLength(2);
    expect(rankRequests[1]).toEqual(rankRequests[0]);
    await page.unroute('**/api/ranks/track');
    const ranked = await getRealmView(db, admin, realm);
    expect(ranked.rankTracks.levels.bronze).toBe(1);
    expect(ranked.balance).toBe(expectedWallet - config.rankTracks.tracks[0].levels[0].cost);
    expect(ranked.packPrice).toBe(
      config.packPrice - config.rankTracks.tracks[0].levels[0].benefits.packDiscount,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: '.test-data/collector-ranks-mobile.png', fullPage: true });
    await showScreen(page, 'collection');
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: '.test-data/physical-collection-mobile.png' });
    await assertTradingCardFaces(page.locator('#collection .card-face'));
    await inspectCollection.click();
    await expect(inspection).toBeVisible();
    expect(await inspection.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: '.test-data/card-inspection-mobile.png' });
    await inspection.getByRole('button', { name: 'Close card inspection', exact: true }).click();
    await expect(inspectCollection).toBeFocused();

    // Consecutive ordinary openings must work without clock edits, cooldown
    // waits or navigation resets. The first also exercises nested inspection.
    const beforeConsecutive = await getRealmView(db, admin, realm);
    expect(beforeConsecutive.effectiveCooldownSeconds).toBe(0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const studio = await choosePack(page);
    await page.getByLabel('Show card reveals', { exact: true }).check();
    await page.screenshot({ path: '.test-data/opening-room-desktop.png' });
    const openingRequests: { requestKey: string; packCount: number }[] = [];
    await page.route('**/api/open', async (route) => {
      openingRequests.push(route.request().postDataJSON());
      await route.continue();
    });
    for (const count of [1, 5, 10] as const) {
      if (count === 10) {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: '.test-data/opening-room-mobile.png' });
      }
      await page
        .getByRole('group', { name: 'Packs per opening' })
        .getByRole('button', {
          name: `${count} ${count === 1 ? 'pack' : 'packs'}`,
          exact: true,
        })
        .click();
      const response = page.waitForResponse(
        (result) => new URL(result.url()).pathname === '/api/open',
      );
      const openButton = studio.locator('.pack-primary-open');
      await expect(openButton).toBeEnabled();
      await openButton.click();
      const result = await (await response).json();
      expect(result).toMatchObject({ ok: true, charged: beforeConsecutive.packPrice * count });
      if (count === 1) {
        const reveal = page.getByRole('region', {
          name: 'Pack reveal: All Characters',
          exact: true,
        });
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect(await reveal.evaluate((node) => node.closest('main') !== null)).toBe(true);
        await page.screenshot({ path: '.test-data/inline-opening-sealed-desktop.png' });
        await reveal.getByRole('button', { name: 'Show all cards', exact: true }).click();
        await page.screenshot({ path: '.test-data/inline-opening-summary-desktop.png' });
        const nestedName = result.characters[0].name;
        const inspectReveal = reveal.getByRole('button', {
          name: `Inspect ${nestedName}`,
          exact: true,
        });
        await inspectReveal.click();
        const nested = page.getByRole('dialog', {
          name: `${nestedName} card details`,
          exact: true,
        });
        await expect(nested).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(nested).toHaveCount(0);
        await expect(reveal).toBeVisible();
        await expect(inspectReveal).toBeFocused();
        await reveal.getByRole('button', { name: 'Return to pack', exact: true }).click();
        await expect(reveal).toHaveCount(0);
        await page.getByLabel('Show card reveals', { exact: true }).uncheck();
      }
      await expect(openButton).toBeEnabled();
    }
    expect(openingRequests).toHaveLength(3);
    expect(openingRequests.map((request) => request.packCount)).toEqual([1, 5, 10]);
    expect(new Set(openingRequests.map((request) => request.requestKey)).size).toBe(3);
    await page.unroute('**/api/open');
    const afterConsecutive = await getRealmView(db, admin, realm);
    expect(afterConsecutive.cards).toHaveLength(beforeConsecutive.cards.length + 16);
    expect(afterConsecutive.balance).toBe(
      beforeConsecutive.balance - beforeConsecutive.packPrice * 16,
    );

    // Recycling sends one request on its first click and immediately credits
    // the displayed server-calculated character return.
    await showScreen(page, 'collection');
    const recycled = afterConsecutive.cards[0],
      credit = afterConsecutive.characterValues[recycled.id].recycleValue;
    let recycleRequests = 0;
    await page.route('**/api/recycle', async (route) => {
      recycleRequests++;
      await route.continue();
    });
    await page
      .getByRole('button', { name: `Recycle ${recycled.name} for ${credit} gems`, exact: true })
      .click();
    await expect
      .poll(async () => (await getRealmView(db, admin, realm)).cards.length)
      .toBe(afterConsecutive.cards.length - 1);
    expect(recycleRequests).toBe(1);
    expect((await getRealmView(db, admin, realm)).balance).toBe(afterConsecutive.balance + credit);
    await page.unroute('**/api/recycle');
    await loginDiscord(db, '100000000000000001', undefined, {
      username: 'atlas_admin',
      displayName: 'Atlas Admin',
      avatarUrl: brokenAvatar,
    });
    await page.reload();
    await expect(page.locator('.header-player .discord-avatar img')).toHaveCount(0);
    await expect(page.locator('.header-player .discord-avatar')).toHaveText('A');
    expect(avatarRequests).toBeGreaterThan(0);
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    // This helper refreshes the shared fixture administrator's public profile;
    // restore it so later helpers can retain their strict no-external-request
    // expectations without inheriting this isolated avatar image fixture.
    if (original.discordProfile)
      await db.query(
        'UPDATE discord_profiles SET username=$2,display_name=$3,avatar_url=$4,updated_at=$5 WHERE account_id=$1',
        [
          admin,
          original.discordProfile.username,
          original.discordProfile.displayName,
          original.discordProfile.avatarUrl ?? null,
          original.discordProfile.updatedAt,
        ],
      );
    else await db.query('DELETE FROM discord_profiles WHERE account_id=$1', [admin]);
  }
}
