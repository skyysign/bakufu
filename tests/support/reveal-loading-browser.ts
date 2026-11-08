import { readFileSync } from 'node:fs';
import { expect, type Browser, type Locator } from '@playwright/test';
import { defaultConfig } from './prototype-config';
import {
  createRealm,
  getRealmView,
  previewRealmCatalog,
  type Database,
} from '../../packages/db/src/index';
import type { OpeningResult } from '../../packages/core/src/index';
import { catalogSchema } from '../../packages/importers/src/json';
import { assertPortraitGallery } from './reveal-gallery';
import { choosePack } from './screen-browser';

type Receipt = Extract<OpeningResult, { ok: true }>;
const originalImage =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 120"><rect width="80" height="120" fill="#202840"/><circle cx="40" cy="40" r="23" fill="#e8c1aa"/><path d="M7 120V93q0-27 33-27t33 27v27" fill="#9872d0"/><path d="M18 43q-8-34 23-34 28 4 23 38L44 22 18 49z" fill="#32234b"/><path d="M27 43h7m12 0h7M34 57h12" stroke="#46304e" stroke-width="3"/></svg>';
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

// Delayed original illustrations exercise actual browser decoding and real
// opening receipts. Every remote request is intercepted; no provider is contacted.
export async function verifyRevealLoading(
  browser: Browser,
  db: Database,
  origin: string,
  admin: string,
  email: string,
  password: string,
) {
  const original = catalogSchema.parse(
    JSON.parse(
      readFileSync(new URL('../../apps/web/public/catalog-scale.v1.json', import.meta.url), 'utf8'),
    ),
  );
  async function fixture(tag: string, packSize = 1, maximumCategoryPacks = 0) {
    const choice = {
      rightsConfirmed: true,
      data: {
        ...original,
        characters: original.characters.map((character, index) => ({
          ...character,
          artwork: {
            url: `https://cdn.myanimelist.net/images/characters/reveal-fixture/${tag}-${index}.png`,
            sourceUrl: `https://myanimelist.net/character/${910000000 + index}`,
            permission: 'Original browser fixture illustration, MIT; no provider image request',
          },
        })),
      },
    };
    const config = { ...defaultConfig, packSize, startingGems: 1000, maximumCategoryPacks };
    const preview = await previewRealmCatalog(db, admin, config, choice);
    return createRealm(
      db,
      admin,
      `Original reveal loading ${tag}`,
      config,
      choice,
      preview.fingerprint,
    );
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    page = await context.newPage(),
    errors: Error[] = [],
    external: string[] = [],
    imageRequests = new Map<string, number>(),
    receivedImages = new Set<string>();
  const artworkGate = deferred(),
    apiGate = deferred(),
    stalledGate = deferred(),
    closedGate = deferred();
  let receipt: Receipt | null = null,
    openingRequests = 0,
    holdApi = false,
    holdArtwork = false,
    brokenUrl: string | null = null,
    stalledUrl: string | null = null,
    apiCommitted = false;
  page.on('pageerror', (error) => errors.push(error));
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('https://cdn.myanimelist.net/images/characters/reveal-fixture/')) {
      imageRequests.set(url, (imageRequests.get(url) ?? 0) + 1);
      if (url === brokenUrl) return route.abort('failed');
      if (url === stalledUrl) {
        await stalledGate.promise;
        // The browser may cancel this image after the bounded preparation wait.
        await route
          .fulfill({ status: 200, contentType: 'image/svg+xml', body: originalImage })
          .catch(() => {});
        return;
      }
      if (holdArtwork && receipt?.characters.some((character) => character.artwork?.url === url))
        await artworkGate.promise;
      receivedImages.add(url);
      return route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        headers: { 'Cache-Control': 'public, max-age=3600' },
        body: originalImage,
      });
    }
    if (new URL(url).origin === origin) return route.continue();
    external.push(url);
    return route.abort();
  });
  const dialog = page.getByRole('region', { name: /^Pack reveal: / }),
    preparation = page.getByRole('region', { name: 'Opening preparation', exact: true }),
    pack = page.locator('.pack-detail');
  async function visit(realm: string, packName = 'All Characters') {
    await page.goto(`${origin}/packs?realm=${realm}`);
    await choosePack(page, packName);
    await expect(page.getByLabel('Show card reveals', { exact: true })).toBeEnabled();
    await page.getByLabel('Show card reveals', { exact: true }).check();
  }
  async function wrapperAppearance(wrapper: Locator) {
    return wrapper.evaluate((node) =>
      Array.from(node.classList).filter((name) => /^foil-\d$|^motif-/.test(name)).sort(),
    );
  }
  await page.route(`${origin}/api/open`, async (route) => {
    openingRequests++;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    const value = (await response.json()) as OpeningResult;
    expect(value.ok).toBe(true);
    if (!value.ok) throw new Error('Original opening fixture failed.');
    receipt = value;
    apiCommitted = true;
    if (holdApi) await apiGate.promise;
    await route.fulfill({ response });
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
    const readyRealm = await fixture('ready', 1, 10);
    const readyView = await getRealmView(db, admin, readyRealm),
      themedPack = readyView.packs.find(
        (entry, index) => index % 4 !== 0 && entry.category !== null,
      );
    if (!themedPack) throw new Error('Original loading fixture needs a non-purple category pack.');
    await visit(readyRealm, themedPack.name);
    const chosenAppearance = await wrapperAppearance(pack.locator('.illustrated-pack'));
    expect(chosenAppearance.some((name) => name.startsWith('motif-'))).toBe(true);
    expect(chosenAppearance).not.toContain('motif-collection');
    expect(chosenAppearance).not.toContain('foil-0');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByRole('button', { name: '5 packs', exact: true }).click();
    holdApi = true;
    holdArtwork = true;
    await pack.getByRole('button', { name: /Open 5 packs/ }).click();
    await expect(preparation).toBeVisible();
    expect(await wrapperAppearance(preparation.locator('.illustrated-pack'))).toEqual(
      chosenAppearance,
    );
    await expect.poll(() => apiCommitted).toBe(true);
    await expect(dialog).toHaveCount(0);
    await expect(pack).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
    const roomBounds = await preparation.boundingBox();
    expect(roomBounds && roomBounds.width === 1440 && roomBounds.height >= 1000).toBeTruthy();
    expect(new URL(page.url()).pathname).toBe('/packs');
    await page.screenshot({ path: '.test-data/reveal-preparing-request.png' });
    apiGate.release();
    await expect(preparation).toContainText('Preparing your cards');
    await expect
      .poll(() =>
        receipt?.characters.some(
          (character) => !!character.artwork && imageRequests.has(character.artwork.url),
        ),
      )
      .toBe(true);
    await expect(dialog).toHaveCount(0);
    await page.screenshot({ path: '.test-data/reveal-preparing-artwork.png' });
    artworkGate.release();
    holdApi = false;
    holdArtwork = false;
    await expect(dialog).toBeVisible();
    await expect(preparation).toHaveCount(0);
    await expect(dialog.locator('.bundle-pack .illustrated-pack')).toHaveCount(5);
    for (const wrapper of await dialog.locator('.bundle-pack .illustrated-pack').all())
      expect(await wrapperAppearance(wrapper)).toEqual(chosenAppearance);
    await dialog.getByRole('button', { name: 'Open 5 packs', exact: true }).click();
    await expect(dialog).toHaveClass(/reveal-phase-charging/);
    expect(await wrapperAppearance(dialog.locator('.opening-seal .illustrated-pack'))).toEqual(
      chosenAppearance,
    );
    await dialog.getByRole('button', { name: 'Show all cards', exact: true }).click();
    await assertPortraitGallery(dialog, 5);
    await expect
      .poll(() =>
        dialog
          .locator('.provider-portrait')
          .evaluateAll(
            (images) =>
              images.length === 5 &&
              images.every(
                (image) =>
                  (image as HTMLImageElement).complete &&
                  (image as HTMLImageElement).naturalWidth > 0,
              ),
          ),
      )
      .toBe(true);
    // A skipped charge must not later replace the complete gallery with one face.
    await page.waitForTimeout(1600);
    await expect(dialog).toHaveClass(/reveal-phase-summary/);
    await dialog.screenshot({ path: '.test-data/reveal-summary-five-desktop.png' });
    expect((await getRealmView(db, admin, readyRealm)).balance).toBe(950);
    await dialog.getByRole('button', { name: 'Return to pack' }).click();

    // Close while the server response is pending: it still commits once, and
    // late delivery must not reopen an animation that was explicitly dismissed.
    await page.unroute(`${origin}/api/open`);
    const closedRealm = await fixture('closed');
    await visit(closedRealm);
    let closedCommitted = false;
    await page.route(`${origin}/api/open`, async (route) => {
      openingRequests++;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      closedCommitted = true;
      await closedGate.promise;
      await route.fulfill({ response });
    });
    await pack.getByRole('button', { name: /Open pack/ }).click();
    await expect(preparation).toBeVisible();
    await expect.poll(() => closedCommitted).toBe(true);
    await preparation.getByRole('button', { name: 'Return to pack', exact: true }).click();
    await expect(preparation).toHaveCount(0);
    await expect(dialog).toHaveCount(0);
    await expect(pack.locator('[id^="pack-open-"]')).toBeDisabled();
    const backToPacks = pack.getByRole('link', { name: 'All packs', exact: true });
    await expect(backToPacks).toHaveAttribute('aria-disabled', 'true');
    await backToPacks.click({ force: true });
    expect(new URL(page.url()).pathname).toBe('/packs');
    closedGate.release();
    await expect(pack.getByRole('button', { name: /Open pack/ })).toBeEnabled();
    await expect(dialog).toHaveCount(0);
    expect((await getRealmView(db, admin, closedRealm)).cards).toHaveLength(1);
    expect((await getRealmView(db, admin, closedRealm)).balance).toBe(990);
    await page.unroute(`${origin}/api/open`);

    // An error and a stalled image both fall back within the shared deadline.
    const fallbackRealm = await fixture('fallback');
    await visit(fallbackRealm);
    await page.getByRole('button', { name: '5 packs', exact: true }).click();
    await page.route(`${origin}/api/open`, async (route) => {
      openingRequests++;
      const response = await route.fetch();
      const value = (await response.json()) as Receipt;
      const uncached = value.characters.flatMap((character) =>
        character.artwork && !receivedImages.has(character.artwork.url)
          ? [character.artwork.url]
          : [],
      );
      expect(uncached.length).toBeGreaterThanOrEqual(2);
      [brokenUrl, stalledUrl] = uncached;
      await route.fulfill({ response });
    });
    await pack.getByRole('button', { name: /Open 5 packs/ }).click();
    await expect(preparation).toBeVisible();
    await expect(dialog).toBeVisible({ timeout: 9000 });
    await dialog.getByRole('button', { name: 'Show all cards', exact: true }).click();
    await assertPortraitGallery(dialog, 5);
    expect(imageRequests.get(brokenUrl!)).toBe(1);
    expect(imageRequests.get(stalledUrl!)).toBe(1);
    await expect(dialog.locator(`img[src="${brokenUrl}"]`)).toHaveCount(0);
    await expect(dialog.locator(`img[src="${stalledUrl}"]`)).toHaveCount(0);
    stalledGate.release();
    await page.screenshot({ path: '.test-data/reveal-summary-fallback.png' });
    await dialog.getByRole('button', { name: 'Return to pack' }).click();
    await page.unroute(`${origin}/api/open`);

    // Fifty-card openings preserve portrait geometry and readable scrollable
    // summaries on both a desktop and a narrow mobile screen.
    const fiftyRealm = await fixture('fifty', 5);
    await visit(fiftyRealm);
    await page.getByRole('button', { name: '10 packs', exact: true }).click();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await pack.getByRole('button', { name: /Open 10 packs/ }).click();
    await expect(dialog.getByRole('heading', { name: 'Your 10-pack opening' })).toBeVisible({
      timeout: 9000,
    });
    await assertPortraitGallery(dialog, 50);
    await expect(dialog.locator('video')).toHaveCount(0);
    await dialog.screenshot({ path: '.test-data/reveal-summary-fifty-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await assertPortraitGallery(dialog, 50);
    await page.screenshot({ path: '.test-data/reveal-summary-fifty-mobile.png' });
    await dialog.getByRole('article').last().scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
    expect(await dialog.evaluate((node) => node.scrollTop)).toBe(0);
    await page.screenshot({ path: '.test-data/reveal-summary-fifty-mobile-last.png' });
    await dialog.getByRole('button', { name: 'Return to pack' }).click();
    expect((await getRealmView(db, admin, fiftyRealm)).cards).toHaveLength(50);
    expect((await getRealmView(db, admin, fiftyRealm)).balance).toBe(900);
    expect(openingRequests).toBe(3);
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  } finally {
    apiGate.release();
    artworkGate.release();
    stalledGate.release();
    closedGate.release();
    await context.close();
  }
}
