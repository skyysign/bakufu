import { expect, type Page } from '@playwright/test';
import type { RealmView } from '../../packages/db/src/index';
import { choosePack, showScreen } from './screen-browser';
import { assertTradingCardFaces } from './reveal-gallery';

// The production discovery view is an artwork-first catalog. Information stays
// keyboard/touch accessible and selecting a pack does not perform gameplay.
export async function verifyPackDiscovery(page: Page, view: RealmView) {
  const tile = page.locator('.pack').filter({
    has: page.getByRole('link', { name: 'Explore All Characters', exact: true }),
  });
  await expect(page.locator('.featured-character')).toHaveCount(
    Math.min(3, view.featuredCharacters.length),
  );
  expect(
    await page
      .locator('.featured-character')
      .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-character-id'))),
  ).toEqual(view.featuredCharacters.slice(0, 3).map((character) => character.id));
  if (view.featuredCharacters.length) {
    await assertTradingCardFaces(page.locator('.featured-character .card-face'));
    const first = view.featuredCharacters[0];
    const inspect = page
      .locator('.featured-character')
      .first()
      .getByRole('button', {
        name: `Inspect ${first.name}`,
        exact: true,
      });
    // The banner floats continuously; keyboard activation also verifies that
    // its inspection action is usable without waiting for motion to stop.
    await inspect.focus();
    await page.keyboard.press('Enter');
    const details = page.getByRole('dialog', { name: `${first.name} card details`, exact: true });
    await expect(details).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(details).toHaveCount(0);
    await expect(inspect).toBeFocused();
  }
  await expect(tile.locator('.portrait-frame')).toHaveCount(0);
  await expect(tile.locator('[data-pack-style="themed"]')).toHaveCount(1);
  const artwork = await tile.locator('.catalog-pack-art').boundingBox();
  expect(artwork && artwork.width >= 160 && artwork.height >= 240).toBe(true);
  await expect(tile.locator('.odds')).toBeHidden();
  await expect(tile.locator('[id^="pack-open-"]')).toHaveCount(0);
  const info = tile.getByLabel('Pack information for All Characters', { exact: true });
  await info.focus();
  await page.keyboard.press('Enter');
  await expect(tile.locator('.odds')).toBeVisible();
  await expect(tile.locator('.pack-insight-content')).toContainText(
    'One active owner per character in this realm',
  );
  await page.keyboard.press('Escape');
  await expect(tile.locator('.odds')).toBeHidden();
  await page.locator('#packs-title').focus();
  await info.hover();
  await expect(tile.locator('.odds')).toBeVisible();
  await info.click();
  await expect(tile.locator('.odds')).toBeVisible();
  await page.locator('#packs-title').focus();
  await page.getByRole('heading', { name: 'Explore the packs', exact: true }).hover();
  await info.hover();
  const popup = await tile.locator('.pack-insight-content').boundingBox();
  if (!popup) throw new Error('Pack information bubble is missing.');
  // Traverse the space between the trigger and bubble without keeping focus
  // inside it: the pointer must be able to reach and read the revealed text.
  await page.mouse.move(popup.x + popup.width / 2, popup.y + 45, { steps: 12 });
  await expect(tile.locator('.odds')).toBeVisible();
  await page.getByRole('heading', { name: 'Explore the packs', exact: true }).hover();
  await expect(tile.locator('.odds')).toBeHidden();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: '.test-data/themed-discovery-catalog-desktop.png' });
  await page.locator('.discovery-hero').screenshot({
    path: '.test-data/themed-discovery-banner-desktop.png',
  });

  const detail = await choosePack(page),
    selectedUrl = page.url(),
    stage = detail.locator('.selected-pack-art'),
    surface = stage.locator('.tilt-surface');
  await expect(page.locator('.discovery-hero,.discovery-pack-grid')).toHaveCount(0);
  await expect(page.locator('.game-header,.site-footer')).toHaveCount(0);
  await expect(page.locator('main')).toHaveClass(/opening-studio/);
  await expect(detail.getByRole('link', { name: 'All packs', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Packs per opening' })).toBeVisible();
  await expect(detail.locator('.odds')).toBeHidden();
  const packCenter = await surface.boundingBox();
  if (!packCenter) throw new Error('The floating pack is missing.');
  expect(
    Math.abs(packCenter.x + packCenter.width / 2 - page.viewportSize()!.width / 2),
  ).toBeLessThan(4);
  const floatAnimation = await detail
    .locator('.pack-stage-floating')
    .evaluate((node) => getComputedStyle(node).animationName);
  expect(floatAnimation).toBe('studio-float');
  const bounds = await stage.boundingBox();
  if (!bounds) throw new Error('Selected pack stage is missing.');
  await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.3);
  await expect
    .poll(() => surface.evaluate((node) => node.style.getPropertyValue('--tilt-y')))
    .not.toBe('');
  expect(await surface.evaluate((node) => node.style.getPropertyValue('--tilt-y'))).not.toBe(
    '0deg',
  );
  await page.mouse.move(1, 1);
  await expect
    .poll(() => surface.evaluate((node) => node.style.getPropertyValue('--tilt-y')))
    .toBe('0deg');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() =>
      detail
        .locator('.pack-stage-floating')
        .evaluate((node) => getComputedStyle(node).animationName),
    )
    .toBe('none');
  await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.3);
  expect(await surface.evaluate((node) => node.style.getPropertyValue('--tilt-y'))).toBe('0deg');
  await page.mouse.move(1, 1);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.screenshot({ path: '.test-data/themed-opening-pack-desktop.png' });
  await page.reload();
  await expect(detail.getByRole('heading', { name: 'All Characters', exact: true })).toBeVisible();
  expect(page.url()).toBe(selectedUrl);
  await showScreen(page, 'packs');
  await expect(tile).toBeVisible();
  await page.goBack();
  await expect(detail).toBeVisible();
  expect(page.url()).toBe(selectedUrl);
  await page.goForward();
  await expect(tile).toBeVisible();
  await page.setViewportSize({ width: 600, height: 900 });
  await info.hover();
  await expect(tile.locator('.odds')).toBeVisible();
  const tabletBubble = await tile.locator('.pack-insight-content').boundingBox();
  expect(
    tabletBubble && tabletBubble.x >= 11.5 && tabletBubble.x + tabletBubble.width <= 588.5,
  ).toBe(true);
  await page.screenshot({ path: '.test-data/themed-pack-information-tablet.png' });
  await page.locator('#packs-title').focus();
  await page.getByRole('heading', { name: 'Explore the packs', exact: true }).hover();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // A clipped hero can hide text overflow without widening the document.
  // Check the actual text fragments as well as the overall page dimensions.
  expect(
    await page.locator('.discovery-hero h1').evaluate((heading) => {
      const hero = heading.closest('.discovery-hero')!.getBoundingClientRect(),
        text = document.createRange();
      text.selectNodeContents(heading);
      return Array.from(text.getClientRects())
        .filter((rect) => rect.width > 0)
        .every((rect) => rect.left >= hero.left && rect.right <= hero.right);
    }),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: '.test-data/themed-discovery-catalog-mobile.png' });
  await page.locator('.discovery-hero').screenshot({
    path: '.test-data/themed-discovery-banner-mobile.png',
  });
  await choosePack(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('.game-header,.site-footer')).toHaveCount(0);
  const mobilePack = await surface.boundingBox();
  const mobileOpen = await detail.locator('.pack-primary-open').boundingBox();
  expect(mobilePack && mobilePack.width >= 185 && mobilePack.width <= 240).toBe(true);
  expect(mobilePack && Math.abs(mobilePack.x + mobilePack.width / 2 - 195) < 3).toBe(true);
  expect(mobileOpen && mobileOpen.y >= 0 && mobileOpen.y + mobileOpen.height <= 844).toBe(true);
  await page.screenshot({ path: '.test-data/themed-opening-pack-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
}
