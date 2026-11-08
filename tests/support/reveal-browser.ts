import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, type BrowserContext } from '@playwright/test';
import { tiers } from '../../packages/config/src/index';
import { defaultConfig } from './prototype-config';
import { catalogSchema } from '../../packages/importers/src/json';
import type { OpeningResult } from '../../packages/core/src/index';
import {
  createRealm,
  previewRealmCatalog,
  exportPlayer,
  getRealmView,
  openPack,
  provisionPlayer,
  type Database,
} from '../../packages/db/src/index';
import { customChoice } from './catalog-fixture';
import { overlapChoice } from './pack-plan-fixture';
import { assertPortraitGallery, assertTradingCardFaces } from './reveal-gallery';
import { choosePack } from './screen-browser';

type Receipt = Extract<OpeningResult, { ok: true }>;
export async function verifyPackReveals(
  context: BrowserContext,
  db: Database,
  admin: string,
  origin: string,
) {
  const page = await context.newPage(),
    errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  const dialog = page.getByRole('region', { name: 'Pack reveal: All Characters', exact: true });
  const preference = page.getByLabel('Show card reveals', { exact: true });
  const packButton = page.locator('.pack-detail [id^="pack-open-"]');
  async function fixture(size = 1, catalog: unknown = overlapChoice) {
    const config = {
      ...defaultConfig,
      minimumPoolSize: 1,
      maximumCategoryPacks: 0,
      packSize: size,
    };
    const preview = await previewRealmCatalog(db, admin, config, catalog);
    const id = await createRealm(
      db,
      admin,
      'Reveal browser fixture',
      config,
      catalog,
      preview.fingerprint,
    );
    return { id, packId: (await getRealmView(db, admin, id)).packs[0].id };
  }
  async function visit(realm: { id: string }) {
    await page.goto(`${origin}/?realm=${realm.id}`);
    await choosePack(page);
    await expect(preference).toBeEnabled();
  }
  function response() {
    return page.waitForResponse(
      (result) => result.url() === `${origin}/api/open` && result.request().method() === 'POST',
    );
  }
  async function open(): Promise<Receipt> {
    const received = response();
    await packButton.click();
    const value = await (await received).json();
    expect(value.ok).toBe(true);
    return value;
  }
  async function unchanged(realmId: string, archive: Awaited<ReturnType<typeof exportPlayer>>) {
    const current = await exportPlayer(db, admin, realmId);
    expect({ ...current, exportedAt: archive.exportedAt }).toEqual(archive);
  }
  try {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const single = await fixture();
    await visit(single);
    await preference.check();
    let deliver!: () => void,
      committed = false,
      requests = 0;
    const delivery = new Promise<void>((resolve) => {
      deliver = resolve;
    });
    await page.route(`${origin}/api/open`, async (route) => {
      requests++;
      const result = await route.fetch();
      expect(result.status()).toBe(200);
      committed = true;
      await delivery;
      await route.fulfill({ response: result });
    });
    const result = response();
    await packButton.click();
    try {
      await expect.poll(() => committed).toBe(true);
      await expect(dialog).toHaveCount(0);
      await expect(packButton).toHaveCount(0);
      await expect(
        page.getByRole('region', { name: 'Opening preparation', exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect((await getRealmView(db, admin, single.id)).balance).toBe(90);
    } finally {
      deliver();
    }
    const receipt: Receipt = await (await result).json();
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await dialog.evaluate((node) => node.closest('main') !== null)).toBe(true);
    const roomBounds = await dialog.boundingBox(),
      viewport = page.viewportSize()!;
    expect(
      roomBounds &&
        roomBounds.x === 0 &&
        roomBounds.width === viewport.width &&
        roomBounds.height >= viewport.height,
    ).toBe(true);
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
    await expect(dialog.locator('.opening-seal .portrait-frame')).toHaveCount(0);
    const saved = await exportPlayer(db, admin, single.id);
    await expect(
      dialog.getByRole('heading', { name: receipt.characters[0].name, exact: true }),
    ).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Reveal card 1', exact: true })).toBeFocused();
    // This is an ordinary page: keyboard navigation can reach the document's
    // skip link instead of being trapped inside a popup.
    await dialog.getByRole('button', { name: 'Return to pack', exact: true }).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('link', { name: 'Skip to content', exact: true })).toBeFocused();
    await dialog.getByRole('button', { name: 'Reveal card 1', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(
      dialog.getByRole('heading', { name: receipt.characters[0].name, exact: true }),
    ).toBeVisible();
    await expect(dialog.getByRole('status')).toContainText(receipt.characters[0].tier);
    await expect(page.locator('#collection')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#packs-title')).toBeFocused();
    await unchanged(single.id, saved);
    expect(requests).toBe(1);
    await page.unroute(`${origin}/api/open`);

    // Another participant consumes the last card after the page's availability was loaded.
    const stale = await fixture();
    const other = await provisionPlayer(
      db,
      stale.id,
      'reveal-other@example.test',
      randomBytes(24).toString('hex'),
    );
    await visit(stale);
    expect(await openPack(db, other, stale.id, stale.packId, randomUUID())).toMatchObject({
      ok: true,
    });
    const failed = response();
    await packButton.click();
    expect(await (await failed).json()).toMatchObject({ ok: false, code: 'EMPTY_POOL' });
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.pack-studio-wallet')).toContainText('100');
    expect((await getRealmView(db, admin, stale.id)).cards).toHaveLength(0);

    const retry = await fixture(),
      attempts: { requestKey: string }[] = [];
    await visit(retry);
    await page.route(`${origin}/api/open`, async (route) => {
      attempts.push(route.request().postDataJSON());
      if (attempts.length === 1) {
        expect((await route.fetch()).status()).toBe(200);
        await route.abort('failed');
      } else await route.continue();
    });
    await packButton.click();
    await expect(packButton).toHaveText('Retry this opening');
    await expect(dialog).toHaveCount(0);
    const recovered = await open();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Show all cards', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Your pack contents' })).toBeVisible();
    await assertPortraitGallery(dialog, 1);
    await expect(
      dialog.getByRole('heading', { name: recovered.characters[0].name, exact: true }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Open more packs' }).click();
    await expect(dialog).toHaveCount(0);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toEqual(attempts[1]);
    expect((await getRealmView(db, admin, retry.id)).balance).toBe(90);
    expect((await getRealmView(db, admin, retry.id)).cards).toHaveLength(1);
    await page.unroute(`${origin}/api/open`);

    const multi = await fixture(3, customChoice);
    await visit(multi);
    const multiple = await open(),
      savedMultiple = await exportPlayer(db, admin, multi.id);
    for (let i = 0; i < 3; i++) {
      if (i === 0) await dialog.getByRole('button', { name: 'Reveal card 1', exact: true }).click();
      await expect(
        dialog.getByRole('heading', { name: multiple.characters[i].name, exact: true }),
      ).toBeVisible();
      if (i < 2) await dialog.getByRole('button', { name: 'Next card', exact: true }).click();
    }
    await dialog.getByRole('button', { name: 'View all cards', exact: true }).click();
    await expect(dialog.getByRole('article')).toHaveCount(3);
    await assertPortraitGallery(dialog, 3);
    await dialog.getByRole('button', { name: 'Return to pack', exact: true }).click();
    await unchanged(multi.id, savedMultiple);

    const reduced = await fixture(2, customChoice);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await visit(reduced);
    await open();
    await expect(dialog.getByRole('heading', { name: 'Your pack contents' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Reveal card 1' })).toHaveCount(0);
    await expect(dialog.getByRole('article')).toHaveCount(2);
    const bounds = await dialog.boundingBox();
    expect(bounds && bounds.x >= 0 && bounds.width <= 390 && bounds.height >= 844).toBeTruthy();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      await dialog
        .getByRole('article')
        .first()
        .evaluate((node) => getComputedStyle(node).animationName),
    ).toBe('none');
    await dialog.screenshot({ path: '.test-data/pack-reveal-mobile.png' });
    await dialog.getByRole('button', { name: 'Return to pack' }).click();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await open();
    await expect(dialog.getByRole('button', { name: 'Reveal card 1' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Reveal card 1', exact: true }).click();
    await expect(dialog).toHaveClass(/reveal-phase-charging/);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(dialog.getByRole('heading', { name: 'Your pack contents' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Return to pack' }).click();

    const direct = await fixture(1, customChoice);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await visit(direct);
    await preference.uncheck();
    await open();
    await expect(page.locator('#collection')).toHaveCount(0);
    await expect(dialog).toHaveCount(0);
    await page.reload();
    await expect(preference).not.toBeChecked();
    await expect(dialog).toHaveCount(0);
    await preference.check();
    await openPack(db, admin, direct.id, direct.packId, randomUUID());
    await page.reload();
    await expect(preference).toBeChecked();
    await expect(dialog).toHaveCount(0);
    await open();
    const savedDirect = await exportPlayer(db, admin, direct.id);
    await expect(dialog.getByRole('button', { name: 'Reveal card 1' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(packButton).toBeFocused();
    await unchanged(direct.id, savedDirect);
    expect(await page.evaluate(() => localStorage.getItem('card-engine:pack-reveals:v1'))).toBe(
      'on',
    );
    // Fixed original-fixture odds verify that each awarded tier gets a distinct
    // visual mechanism, rather than one animation with three playback speeds.
    const effectAnimations = new Set<string>();
    const scaleChoice = {
      rightsConfirmed: true,
      data: catalogSchema.parse(
        JSON.parse(
          readFileSync(
            new URL('../../apps/web/public/catalog-scale.v1.json', import.meta.url),
            'utf8',
          ),
        ),
      ),
    };
    for (const tier of tiers) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      const tierWeights = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 };
      tierWeights[tier] = 100;
      const tierConfig = {
        ...defaultConfig,
        tierWeights,
        minimumPoolSize: 1,
        maximumCategoryPacks: 0,
      };
      const tierPreview = await previewRealmCatalog(db, admin, tierConfig, scaleChoice);
      const id = await createRealm(
        db,
        admin,
        `${tier} presentation fixture`,
        tierConfig,
        scaleChoice,
        tierPreview.fingerprint,
      );
      await visit({ id });
      const actual = await open();
      expect(actual.characters[0].tier).toBe(tier);
      await dialog.getByRole('button', { name: 'Reveal card 1', exact: true }).click();
      await expect(dialog).toHaveAttribute('data-reveal-effect', tier);
      const animations = await dialog
        .locator('.rarity-effects > span')
        .evaluateAll((nodes) =>
          [...new Set(nodes.map((node) => getComputedStyle(node).animationName))]
            .filter((name) => name !== 'none')
            .sort(),
        );
      expect(animations.length).toBeGreaterThan(0);
      effectAnimations.add(animations.join('|'));
      await page.screenshot({ path: `.test-data/rarity-${tier}-opening-desktop.png` });
      await dialog.getByRole('button', { name: 'Return to pack', exact: true }).click();
      await page.setViewportSize({ width: 390, height: 844 });
      const mobileActual = await open();
      expect(mobileActual.characters[0].tier).toBe(tier);
      await dialog.getByRole('button', { name: 'Reveal card 1', exact: true }).click();
      await expect(dialog).toHaveAttribute('data-reveal-effect', tier);
      const mobileAnimations = await dialog
        .locator('.rarity-effects > span')
        .evaluateAll((nodes) =>
          [...new Set(nodes.map((node) => getComputedStyle(node).animationName))]
            .filter((name) => name !== 'none')
            .sort(),
        );
      expect(mobileAnimations).toEqual(animations);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const mobileRoom = await dialog.boundingBox();
      expect(
        mobileRoom && mobileRoom.x === 0 && mobileRoom.width === 390 && mobileRoom.height >= 844,
      ).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: `.test-data/rarity-${tier}-opening-mobile.png` });
      const skip = dialog.getByRole('button', { name: 'Skip animation', exact: true });
      if (await skip.isVisible()) await skip.click();
      await dialog.locator('.reveal-face').evaluate(async (node) => {
        await Promise.all(node.getAnimations().map((animation) => animation.finished));
      });
      await assertTradingCardFaces(dialog.locator('.reveal-stage .card-face'));
      await dialog.getByRole('button', { name: 'Return to pack', exact: true }).click();
    }
    expect(effectAnimations.size).toBe(tiers.length);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
}
