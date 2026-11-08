import { randomUUID } from 'node:crypto';
import { expect, type Browser } from '@playwright/test';
import { defaultConfig } from '../../packages/config/src/index';
import {
  createRealm,
  getRealmView,
  openPack,
  provisionPlayer,
  recycleCard,
  type Database,
} from '../../packages/db/src/index';

/**
 * Administration → Player collections in a real browser: an admin finds a
 * member by code, sees the card they recycled, restores it with a reason, and
 * the card is back in the member's collection with the gems taken back. Also
 * checks that the card inspector replays the reveal's rarity effect.
 */
export async function verifyAdminCollections(
  browser: Browser,
  db: Database,
  origin: string,
  admin: string,
  email: string,
  password: string,
) {
  const realm = await createRealm(db, admin, 'Collection repair browser fixture', defaultConfig);
  await db.query('DELETE FROM characters WHERE realm_id=$1 AND source_key != $2', [
    realm,
    'lantern-demo:ro',
  ]);
  const player = await provisionPlayer(db, realm, 'collection-browser@example.test', password);
  const pack = (await getRealmView(db, admin, realm)).packs.find(
    (p) => p.name === 'All Characters',
  )!;
  const opening = await openPack(db, player, realm, pack.id, randomUUID());
  if (!opening.ok) throw new Error('Fixture opening failed.');
  const before = (await getRealmView(db, player, realm)).balance;
  const recycled = await recycleCard(db, player, realm, opening.cardIds[0], randomUUID());
  const code = (await getRealmView(db, player, realm)).tradeCode;
  const name = opening.characters[0].name;

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
    await page.goto(`${origin}/admin?task=collections&realm=${realm}`);
    const section = page.getByRole('region', { name: 'Player collections', exact: true });
    await section.getByLabel('Member code (trade ID)', { exact: true }).fill(code);
    const recycledList = section.getByRole('region', { name: 'Recently recycled', exact: true });
    await expect(recycledList).toContainText(name);
    await expect(recycledList).toContainText(`for ${recycled.credited.toLocaleString()} gems`);
    await recycledList.getByRole('button', { name: 'Restore…', exact: true }).click();
    await expect(
      recycledList.getByRole('checkbox', { name: /^Take back the .* gems recycling paid/ }),
    ).toBeChecked();
    const restore = recycledList.getByRole('button', { name: 'Restore card', exact: true });
    await expect(restore).toBeDisabled();
    await recycledList.getByLabel('Reason (saved in the history)').fill('Recycled by accident');
    await restore.click();
    await expect(section.getByRole('status').filter({ hasText: 'is back in' })).toBeVisible();
    await expect(recycledList).toContainText('Nothing recycled.');
    await expect(section.getByRole('region', { name: /^Collection \(1\)$/ })).toContainText(name);
    await expect(section.getByRole('region', { name: 'History', exact: true })).toContainText(
      'Recycled by accident',
    );
    const view = await getRealmView(db, player, realm);
    expect(view.cards.map((card) => card.cardId)).toEqual(opening.cardIds);
    expect(view.balance).toBe(before);

    // Inspecting a card replays its reveal: the rarity effect layer sits behind
    // the card, and the details match the collection inspector.
    await page.goto(`${origin}/wishlist?realm=${realm}`);
    await page.getByRole('button', { name: /^Character glossary/ }).click();
    await page.getByRole('button', { name: `Inspect ${name}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `${name} card details`, exact: true });
    await expect(dialog.locator('.inspector-art .rarity-effects')).toHaveCount(1);
    await expect(dialog.locator('.inspector-art > .card-face')).toHaveCSS(
      'animation-name',
      /card-(arrival|entrance)/,
    );
    await expect(dialog).toContainText('Owned by another collector');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  } finally {
    await context.close();
  }
}
