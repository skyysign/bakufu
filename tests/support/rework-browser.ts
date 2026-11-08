import { choosePack, showScreen } from './screen-browser';
import type { Page } from '@playwright/test';

// The market sell panel picks a card through the searchable card dialog.
async function chooseCardToSell(page: Page, name: string) {
  await page.getByRole('button', { name: 'Choose a card to sell', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Choose a card to sell', exact: true });
  await picker.getByLabel('Search cards by name or series').fill(name);
  await picker.getByRole('button', { name: `Select ${name}`, exact: true }).click();
  await picker.getByRole('button', { name: 'Choose card', exact: true }).click();
  await expect(picker).not.toBeVisible();
}
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, type Browser } from '@playwright/test';
import {
  createRealm,
  buyCollectorRank,
  provisionPlayer,
  openPack,
  getRealmView,
  previewRealmCatalog,
  type Database,
} from '../../packages/db/src/index';
import { defaultConfig } from './prototype-config';
import { defaultConfig as productConfig } from '../../packages/config/src/index';

// An isolated, original catalog economy exercises real HTTP commands and art.
export async function verifyPlayerRework(browser: Browser, db: Database, origin: string) {
  const admin = (
    await db.query('SELECT id FROM accounts WHERE instance_admin=true ORDER BY created_at LIMIT 1')
  ).rows[0].id as string;
  const realm = await createRealm(db, admin, 'Collector interface fixture', {
    ...defaultConfig,
    tierWeights: { common: 0, uncommon: 0, rare: 100, epic: 0, legendary: 0 },
    minimumPoolSize: 1,
  });
  const password = randomBytes(24).toString('hex'),
    sellerEmail = `${randomUUID()}@example.test`,
    buyerEmail = `${randomUUID()}@example.test`;
  const seller = await provisionPlayer(db, realm, sellerEmail, password),
    buyer = await provisionPlayer(db, realm, buyerEmail, password);
  const initial = await getRealmView(db, seller, realm),
    pack = initial.packs.find((item) => item.name === 'All Characters')!;
  const original = await openPack(db, seller, realm, pack.id, randomUUID());
  if (!original.ok) throw new Error('Fixture opening failed.');
  // Historical purchases keep their benefits after the separate shop is retired.
  await buyCollectorRank(db, seller, realm, 1, randomUUID());
  const sellerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    buyerContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  for (const context of [sellerContext, buyerContext])
    await context.route('**/*', (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
  try {
    const page = await sellerContext.newPage(),
      other = await buyerContext.newPage();
    const errors: Error[] = [];
    page.on('pageerror', (error) => errors.push(error));
    other.on('pageerror', (error) => errors.push(error));
    for (const [context, email] of [
      [sellerContext, sellerEmail],
      [buyerContext, buyerEmail],
    ] as const)
      expect(
        (
          await context.request.post(`${origin}/api/login`, {
            headers: { Origin: origin },
            data: { email, password },
          })
        ).status(),
      ).toBe(200);
    await page.goto(`${origin}/?realm=${realm}`);
    await expect(page.locator('.pack')).toHaveCount(initial.packs.length);
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--paper').trim(),
      ),
    ).toBe('#08080d');
    await expect
      .poll(() =>
        page
          .locator('.portrait-atlas')
          .first()
          .evaluate(
            (image) =>
              (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
          ),
      )
      .toBe(true);
    await page.screenshot({ path: '.test-data/rework-desktop.png' });
    expect((await getRealmView(db, seller, realm)).collectorRank.rank).toBe(1);
    await showScreen(page, 'ranks');
    await expect(page.getByRole('region', { name: 'Pack upgrades' })).toHaveCount(0);
    await showScreen(page, 'collection');
    const collection = page.locator('#collection');
    await collection.getByLabel('Search your collection').fill(original.characters[0].name);
    await expect(collection.locator('.character')).toHaveCount(1);
    await collection.getByLabel('Search your collection').fill('no matching fixture');
    await expect(collection.getByRole('heading', { name: 'No matching cards.' })).toBeVisible();
    await collection.getByLabel('Search your collection').fill('');
    await showScreen(page, 'market');
    const market = page.getByRole('region', { name: 'Realm market' });
    await chooseCardToSell(page, original.characters[0].name);
    await expect(market.locator('.sell-selected')).toContainText(original.characters[0].name);
    await market.getByLabel('Asking price (gems)').fill('17');
    await market.getByRole('button', { name: 'List card · 17 gems' }).click();
    await expect(market.locator('.market-card')).toHaveCount(1);
    await showScreen(page, 'collection');
    await expect(
      collection.getByRole('button', {
        name: `${original.characters[0].name} listed on market`,
        exact: false,
      }),
    ).toBeDisabled();
    await other.goto(`${origin}/market?realm=${realm}`);
    const buyerMarket = other.getByRole('region', { name: 'Realm market' });
    const buyRequests: unknown[] = [];
    await other.route('**/api/market', async (route) => {
      buyRequests.push(route.request().postDataJSON());
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (buyRequests.length === 1) await route.abort('failed');
      else await route.fulfill({ response });
    });
    await buyerMarket.getByRole('button', { name: 'Buy card', exact: true }).click();
    await buyerMarket.getByRole('button', { name: 'Confirm market purchase' }).click();
    await buyerMarket.getByRole('button', { name: 'Retry market action' }).click();
    await expect(
      buyerMarket.getByRole('status').filter({ hasText: /purchased|bought|saved|complete/i }),
    ).toBeVisible();
    expect(buyRequests).toHaveLength(2);
    expect(buyRequests[1]).toEqual(buyRequests[0]);
    await other.unroute('**/api/market');
    expect((await getRealmView(db, buyer, realm)).cards.map((card) => card.cardId)).toContain(
      original.cardIds[0],
    );
    await showScreen(other, 'collection');
    await expect(other.locator('#collection .character')).toHaveCount(1);
    expect(await other.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await showScreen(other, 'market');
    await expect(other.locator('#collection')).toHaveCount(0);
    await other.screenshot({ path: '.test-data/rework-mobile-market.png' });
    await showScreen(other, 'packs');
    await other.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await expect.poll(() => other.evaluate(() => scrollY)).toBe(0);
    await expect(other.getByLabel('Choose realm', { exact: true })).toHaveCount(0);
    await showScreen(other, 'account');
    // Mobile: a slim top bar and a bottom tab bar; neither may cover the selector.
    const mobileHeaderLayout = await other.evaluate(() => {
      const selector = document.getElementById('realm')!.getBoundingClientRect();
      return {
        selectorTop: selector.top,
        selectorBottom: selector.bottom,
        headerBottom: document.querySelector('.topbar')!.getBoundingClientRect().bottom,
        navTop: document.querySelector('.game-nav')!.getBoundingClientRect().top,
      };
    });
    expect(mobileHeaderLayout.selectorTop).toBeGreaterThanOrEqual(
      mobileHeaderLayout.headerBottom + 8,
    );
    expect(mobileHeaderLayout.selectorBottom).toBeLessThanOrEqual(mobileHeaderLayout.navTop);

    await showScreen(other, 'packs');
    await other.screenshot({ path: '.test-data/rework-mobile.png' });
    // Opening a real rare receipt mounts the local, silent cinematic only on reveal.
    await showScreen(page, 'packs');
    const opening = await choosePack(page);
    await opening.getByRole('button', { name: /Open pack/ }).click();
    const dialog = page.getByRole('region', { name: 'Pack reveal: All Characters' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('video')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Reveal card 1' }).click();
    await expect(dialog).toHaveClass(/reveal-phase-charging/);
    await expect(dialog).toHaveAttribute('data-reveal-effect', 'rare');
    await expect(dialog.locator('.rarity-effects.effect-rare')).toBeVisible();
    await expect(dialog.locator('video')).toHaveCount(0);
    await page.screenshot({ path: '.test-data/reveal-rare-charge-desktop.png' });
    await dialog.getByRole('button', { name: 'Skip animation', exact: true }).click();
    await expect(dialog).toHaveClass(/reveal-tier-rare/);
    await expect(dialog.locator('video')).toHaveCount(1);
    await expect
      .poll(() =>
        dialog.locator('video').evaluate((video) => (video as HTMLVideoElement).readyState),
      )
      .toBeGreaterThanOrEqual(2);
    await expect
      .poll(() =>
        dialog.locator('video').evaluate((video) => (video as HTMLVideoElement).currentTime),
      )
      .toBeGreaterThan(0);
    await dialog.locator('.reveal-face').evaluate(async (node) => {
      await Promise.all(node.getAnimations().map((animation) => animation.finished));
    });
    await expect(dialog.locator('.reveal-face')).toHaveCSS('opacity', '1');
    // The decoded demo sprite remains cropped to one portrait after moving
    // under the prepared-image wrapper, rather than exposing the entire atlas.
    const preparedAtlas = dialog.locator('.prepared-portrait > img.portrait-atlas');
    await expect(preparedAtlas).toHaveCount(1);
    const atlasCrop = await preparedAtlas.evaluate((image) => {
      const frame = image.closest('.portrait-frame')!.getBoundingClientRect(),
        atlas = image.getBoundingClientRect();
      return { width: atlas.width / frame.width, height: atlas.height / frame.height };
    });
    expect(atlasCrop.width).toBeCloseTo(3, 2);
    expect(atlasCrop.height).toBeCloseTo(4, 2);
    await page.screenshot({ path: '.test-data/rework-rare.png' });
    await dialog.getByRole('button', { name: 'Return to pack' }).click();
    await showScreen(page, 'ranks');
    expect(
      (
        await sellerContext.request.post(origin + '/api/ranks/buy', {
          headers: { Origin: origin },
          data: {
            realmId: realm,
            rank: 2,
            requestKey: randomUUID(),
            expectedRevision: initial.configRevision,
          },
        })
      ).status(),
    ).toBe(200);
    await page.reload();
    await expect
      .poll(async () => (await getRealmView(db, seller, realm)).effectiveRecycleRewards.rare)
      .toBe(defaultConfig.recycleRewards.rare + 1);
    const effective = await getRealmView(db, seller, realm);
    expect(effective.packPrice).toBe(defaultConfig.packPrice - 1);
    const remaining = effective.cards[0];
    await showScreen(page, 'collection');
    await expect(
      page
        .locator('#collection')
        .getByRole('button', { name: `Recycle ${remaining.name} for 7 gems`, exact: true }),
    ).toBeVisible();
    // Reduced motion bypasses the cinematic and goes straight to a static summary.
    const reduced = await browser.newContext({
      reducedMotion: 'reduce',
      storageState: await sellerContext.storageState(),
      viewport: { width: 375, height: 812 },
    });
    try {
      await reduced.route('**/*', (route) =>
        new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
      );
      // Recycle the seller's rare card first so another original rare opening is possible.
      await page
        .locator('#collection')
        .getByRole('button', { name: `Recycle ${remaining.name} for 7 gems`, exact: true })
        .click();
      await expect.poll(async () => (await getRealmView(db, seller, realm)).cards.length).toBe(0);
      const mobile = await reduced.newPage();
      await mobile.goto(`${origin}/?realm=${realm}`);
      await (await choosePack(mobile)).getByRole('button', { name: /Open pack/ }).click();
      const summary = mobile.getByRole('region', { name: 'Pack reveal: All Characters' });
      await expect(summary.getByRole('heading', { name: 'Your pack contents' })).toBeVisible();
      await expect(summary.locator('video')).toHaveCount(0);
      await summary.getByRole('button', { name: 'Return to pack' }).focus();
      await mobile.keyboard.press('Shift+Tab');
      await expect(
        mobile.getByRole('link', { name: 'Skip to content', exact: true }),
      ).toBeFocused();
      await summary.getByRole('button', { name: 'Open more packs', exact: true }).focus();
      await mobile.keyboard.press('Escape');
      await expect(summary).toHaveCount(0);
    } finally {
      await reduced.close();
    }
    // A permitted imported namesake keeps generic engine artwork, even when its name matches demo art.
    const importedCharacterId = randomUUID(),
      importedConfig = {
        ...defaultConfig,
        minimumPoolSize: 1,
        recycleRewards: { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 },
        characterValues: productConfig.characterValues,
      };
    const importedCatalog = {
      rightsConfirmed: true,
      data: {
        schemaVersion: 1,
        source: 'rework-name-check',
        revision: '1',
        license: 'Original fixture text; no provider artwork',
        characters: [
          {
            id: importedCharacterId,
            sourceKey: 'rework-name-check:mira',
            name: 'Mira Tidekeeper',
            series: 'Original namesake fixture',
            categories: ['Fixture'],
            popularity: 1,
          },
        ],
      },
    };
    const importedPreview = await previewRealmCatalog(db, admin, importedConfig, importedCatalog);
    const importedRealm = await createRealm(
      db,
      admin,
      'Imported namesake fixture',
      importedConfig,
      importedCatalog,
      importedPreview.fingerprint,
    );
    await provisionPlayer(db, importedRealm, buyerEmail, password);
    const importedView = await getRealmView(db, buyer, importedRealm);
    await openPack(db, buyer, importedRealm, importedView.packs[0].id, randomUUID());
    await other.goto(`${origin}/collection?realm=${importedRealm}`);
    await showScreen(other, 'collection');
    await expect(other.locator('#collection .character')).toHaveCount(1);
    await expect(other.locator('#collection .character .portrait-atlas')).toHaveCount(0);
    await expect(other.locator('#collection .character .character-portrait')).toHaveCount(1);
    // Zero-valued custom catalogs can still list cards: suggestions respect
    // the market's minimum valid price, and sellers retain their price control.
    const zeroValue = await getRealmView(db, buyer, importedRealm);
    expect(zeroValue.characterValues[importedCharacterId].marketValue).toBe(0);
    await showScreen(other, 'market');
    const zeroMarket = other.getByRole('region', { name: 'Realm market', exact: true });
    await chooseCardToSell(other, zeroValue.cards[0].name);
    await expect(zeroMarket.getByLabel('Asking price (gems)', { exact: true })).toHaveValue('1');
    await zeroMarket.getByLabel('Asking price (gems)', { exact: true }).fill('3');
    await expect(zeroMarket.getByLabel('Asking price (gems)', { exact: true })).toHaveValue('3');
    await zeroMarket.getByLabel('Asking price (gems)', { exact: true }).fill('1');
    const listingSaved = other.waitForResponse(
      (result) =>
        new URL(result.url()).pathname === '/api/market' && result.request().method() === 'POST',
    );
    await zeroMarket.getByRole('button', { name: 'List card · 1 gems', exact: true }).click();
    expect((await listingSaved).status()).toBe(200);
    await expect(zeroMarket.locator('.market-card')).toHaveCount(1);
    await expect(zeroMarket.locator('.market-price')).toContainText('1');
    expect(errors).toEqual([]);
  } finally {
    await sellerContext.close();
    await buyerContext.close();
  }
}
