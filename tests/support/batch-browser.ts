import { readFileSync } from 'node:fs';
import { expect, type Browser } from '@playwright/test';
import { defaultConfig } from './prototype-config';
import {
  createRealm,
  getRealmView,
  previewRealmCatalog,
  type Database,
} from '../../packages/db/src/index';
import type { OpeningResult } from '../../packages/core/src/index';
import { choosePack, showScreen } from './screen-browser';
import { catalogSchema } from '../../packages/importers/src/json';
import { assertPortraitGallery } from './reveal-gallery';
import { verifyPackDiscovery } from './discovery-browser';

// Actual production UI/HTTP/transactions, using only the original local catalog.
export async function verifyBatchPlay(
  browser: Browser,
  db: Database,
  origin: string,
  admin: string,
  email: string,
  password: string,
) {
  const artworkUrl = 'https://cdn.myanimelist.net/images/characters/fixture/original.png',
    original = catalogSchema.parse(
      JSON.parse(
        readFileSync(
          new URL('../../apps/web/public/catalog-scale.v1.json', import.meta.url),
          'utf8',
        ),
      ),
    ),
    artwork = {
      url: artworkUrl,
      sourceUrl: 'https://myanimelist.net/character/910000099',
      permission: 'Original abstract browser-test illustration, MIT',
    };
  const catalog = {
      data: {
        ...original,
        characters: original.characters.map((character) => ({ ...character, artwork })),
      },
      rightsConfirmed: true,
    },
    config = { ...defaultConfig, startingGems: 1000, maximumCategoryPacks: 0 },
    preview = await previewRealmCatalog(db, admin, config, catalog),
    realm = await createRealm(
      db,
      admin,
      'Pack bundle browser fixture',
      config,
      catalog,
      preview.fingerprint,
    );
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    const probe = { starts: 0, cancellations: 0 };
    Object.defineProperty(window, '__openingAudioProbe', { value: probe });
    const createOscillator = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const oscillator = createOscillator.call(this),
        start = oscillator.start.bind(oscillator),
        stop = oscillator.stop.bind(oscillator);
      oscillator.start = (when) => {
        probe.starts++;
        start(when);
      };
      oscillator.stop = (when) => {
        if (when === undefined) probe.cancellations++;
        stop(when);
      };
      return oscillator;
    };
  });
  const external: string[] = [];
  let artworkRequests = 0;
  await context.route('**/*', (route) => {
    if (route.request().url() === artworkUrl) {
      artworkRequests++;
      return route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 120"><rect width="80" height="120" fill="#32274b"/><path d="M10 120V95Q12 70 40 70T70 95v25" fill="#9872d0"/><circle cx="40" cy="43" r="23" fill="#e5b99f"/><path d="M17 41Q12 9 40 12q28-2 23 37L46 23 18 48z" fill="#35244e"/><path d="M28 45h6m12 0h6M35 59h10" stroke="#46304e" stroke-width="3"/></svg>',
      });
    }
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
      errors: Error[] = [];
    page.on('pageerror', (error) => errors.push(error));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const navigation = await page.goto(`${origin}/packs?realm=${realm}`);
    expect(navigation?.headers()['content-security-policy']).toContain(
      'https://cdn.myanimelist.net',
    );
    await expect
      .poll(() =>
        page
          .locator('.spotlight-card .provider-portrait')
          .first()
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await expect(page.locator('.pack .portrait-frame')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Your progression' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Timed gem reward' })).toHaveCount(0);
    await verifyPackDiscovery(page, await getRealmView(db, admin, realm));
    expect((await getRealmView(db, admin, realm)).balance).toBe(1000);
    expect((await getRealmView(db, admin, realm)).cards).toHaveLength(0);
    await showScreen(page, 'ranks');
    await expect(page.locator('.progression-target')).toContainText('20 XP to level 2');
    await choosePack(page);
    const audio = () =>
      page.evaluate(
        () =>
          (window as unknown as { __openingAudioProbe: { starts: number; cancellations: number } })
            .__openingAudioProbe,
      );
    expect((await audio()).starts).toBe(0);
    await expect(page.getByLabel('Show card reveals', { exact: true })).toBeEnabled();
    await page.getByLabel('Show card reveals', { exact: true }).check();
    const quantity = page.getByRole('group', { name: 'Packs per opening' }),
      pack = page.locator('.pack-detail'),
      dialog = page.getByRole('region', { name: 'Pack reveal: All Characters' });
    async function progression(text: string) {
      await showScreen(page, 'ranks');
      await expect(page.locator('.progression-target')).toContainText(text);
      await choosePack(page);
    }
    await expect(quantity.getByRole('button', { name: '1 pack', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('.progression-target')).toHaveCount(0);
    const singleResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/open',
    );
    await pack.getByRole('button', { name: /Open pack/ }).click();
    const single = (await (await singleResponse).json()) as OpeningResult;
    expect(single).toMatchObject({
      ok: true,
      charged: 10,
      progression: { xpAwarded: 10, totalXp: 10 },
    });
    expect(single).not.toHaveProperty('packCount');
    await expect(dialog).toHaveAttribute('data-pack-count', '1');
    await expect(dialog.getByRole('button', { name: 'Reveal card 1', exact: true })).toBeVisible();
    await dialog.getByRole('switch', { name: 'Opening sounds', exact: true }).uncheck();
    await dialog.getByRole('button', { name: 'Reveal card 1', exact: true }).click();
    if (!single.ok) throw new Error('Single opening fixture failed.');
    await expect(dialog).toHaveAttribute('data-reveal-effect', single.characters[0].tier);
    await expect(dialog.locator('.reveal-face')).toBeVisible();
    expect((await audio()).starts).toBe(0);
    await dialog.getByRole('button', { name: 'Return to pack' }).click();
    await progression('10 XP to level 2');

    await quantity.getByRole('button', { name: '5 packs', exact: true }).click();
    await expect(pack.locator('.pack-bundle-cost')).toContainText('5 packs · 5 cards · 50 gems');
    const attempts: unknown[] = [];
    await page.route('**/api/open', async (route) => {
      attempts.push(route.request().postDataJSON());
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (attempts.length === 1) await route.abort('failed');
      else await route.fulfill({ response });
    });
    await pack.getByRole('button', { name: /Open 5 packs/ }).click();
    await expect(
      pack.getByRole('button', { name: 'Retry this opening', exact: true }),
    ).toBeVisible();
    await expect(quantity.getByRole('button', { name: '10 packs', exact: true })).toBeDisabled();
    await pack.getByRole('button', { name: 'Retry this opening', exact: true }).click();
    await expect(dialog).toHaveAttribute('data-pack-count', '5');
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(attempts[0]).toMatchObject({ packCount: 5 });
    await page.unroute('**/api/open');
    await expect(dialog.locator('.bundle-pack')).toHaveCount(5);
    await expect(dialog.getByText('Level up! You reached level 3.', { exact: true })).toBeVisible();
    await dialog.locator('.bundle-pack').evaluateAll(async (packs) => {
      await Promise.all(
        packs.flatMap((pack) => pack.getAnimations()).map((animation) => animation.finished),
      );
    });
    await expect(dialog.locator('.bundle-pack').last()).toHaveCSS('opacity', '1');
    await page.screenshot({ path: '.test-data/batch-five-desktop.png' });
    await dialog.getByRole('switch', { name: 'Opening sounds', exact: true }).check();
    await dialog.getByRole('button', { name: 'Open 5 packs', exact: true }).click();
    await expect.poll(async () => (await audio()).starts).toBeGreaterThan(0);
    const cancellations = (await audio()).cancellations;
    await dialog.getByRole('switch', { name: 'Opening sounds', exact: true }).uncheck();
    await expect.poll(async () => (await audio()).cancellations).toBeGreaterThan(cancellations);
    await expect(dialog.getByRole('status')).toContainText('Pack 1 of 5');
    await expect(dialog.locator('.reveal-face')).toHaveCount(1);
    await expect
      .poll(() =>
        dialog
          .locator('.provider-portrait')
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await dialog.getByRole('button', { name: 'Next card', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('Pack 2 of 5');
    const imageRequestsBeforeGallery = artworkRequests;
    await dialog.getByRole('button', { name: 'Show all cards', exact: true }).click();
    await expect(dialog.locator('.reveal-gallery')).toHaveCount(1);
    await expect(dialog.locator('.reveal-pack-badge')).toHaveCount(5);
    await expect(dialog.locator('.reveal-card')).toHaveCount(5);
    await assertPortraitGallery(dialog, 5);
    expect(await dialog.locator('canvas.prepared-copy').count()).toBeGreaterThan(0);
    expect(
      await dialog
        .locator('.provider-portrait')
        .evaluateAll(
          (portraits) =>
            portraits.length === 5 &&
            portraits.every((portrait) =>
              portrait instanceof HTMLImageElement
                ? portrait.complete && portrait.naturalWidth > 0
                : portrait instanceof HTMLCanvasElement &&
                  portrait.width > 0 &&
                  portrait.height > 0,
            ),
        ),
    ).toBe(true);
    expect(artworkRequests).toBe(imageRequestsBeforeGallery);
    await dialog.getByRole('button', { name: 'Return to pack' }).click();
    await progression('10 XP to level 4');
    expect((await getRealmView(db, admin, realm)).balance).toBe(940);

    await quantity.getByRole('button', { name: '10 packs', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    const tenResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/open',
    );
    await pack.getByRole('button', { name: /Open 10 packs/ }).click();
    const ten = (await (await tenResponse).json()) as OpeningResult;
    expect(ten).toMatchObject({
      ok: true,
      charged: 100,
      packCount: 10,
      cardsPerPack: 1,
      progression: { xpAwarded: 100, totalXp: 160 },
    });
    await expect(dialog.locator('.bundle-pack')).toHaveCount(10);
    await dialog.locator('.bundle-pack').evaluateAll(async (packs) => {
      await Promise.all(
        packs.flatMap((pack) => pack.getAnimations()).map((animation) => animation.finished),
      );
    });
    await expect(dialog.locator('.bundle-pack').last()).toHaveCSS('opacity', '1');
    await page.screenshot({ path: '.test-data/batch-ten-mobile.png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const overflow = await dialog.evaluate((node) => ({
      client: node.clientWidth,
      scroll: node.scrollWidth,
      outside: Array.from(node.querySelectorAll<HTMLElement>('*'))
        .flatMap((item) => {
          const rect = item.getBoundingClientRect(),
            box = node.getBoundingClientRect();
          return rect.width > 0 && (rect.right > box.right || rect.left < box.left)
            ? [
                {
                  className: item.className,
                  left: Math.round(rect.left - box.left),
                  right: Math.round(rect.right - box.right),
                },
              ]
            : [];
        })
        .slice(0, 10),
    }));
    expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.client);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(dialog.locator('.reveal-gallery')).toHaveCount(1);
    await expect(dialog.locator('.reveal-pack-badge')).toHaveCount(10);
    await expect(dialog.locator('video')).toHaveCount(0);
    await expect(dialog.locator('.reveal-card')).toHaveCount(10);
    await assertPortraitGallery(dialog, 10);
    await dialog.getByRole('button', { name: 'Return to pack' }).click();
    await progression('Highest configured level reached');
    expect((await getRealmView(db, admin, realm)).cards).toHaveLength(16);

    await showScreen(page, 'packs');
    await page.locator('.header-recharge').click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/ranks');
    const claim = page.getByRole('region', { name: 'Timed gem reward' });
    await claim.getByRole('button', { name: 'Claim gems', exact: true }).click();
    await expect(claim.getByRole('button', { name: 'Claim on cooldown' })).toBeDisabled();
    await expect(claim.locator('time')).toBeVisible();
    await showScreen(page, 'collection');
    await expect
      .poll(() =>
        page
          .locator('.character .provider-portrait')
          .first()
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await expect(page.locator('.header-recharge')).toContainText('Next gems in');
    await expect(page.locator('.header-recharge')).toHaveAttribute('title', /Next claim:/);
    await page.screenshot({ path: '.test-data/gem-timer-collection-mobile.png' });
    await page.reload();
    await expect(page.locator('.header-recharge')).toContainText('Next gems in');
    expect((await getRealmView(db, admin, realm)).balance).toBe(865);
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  } finally {
    await context.close();
  }
}
