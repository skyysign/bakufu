import { randomBytes, randomUUID } from 'node:crypto';
import { expect, type Browser } from '@playwright/test';
import {
  createRealm,
  getPlayerProfile,
  getRealmView,
  openPack,
  provisionPlayer,
  setWishlistEntry,
  type Database,
} from '../../packages/db/src/index';
import { defaultConfig } from '../../packages/config/src/index';
import { openAccountMenu } from './screen-browser';

/**
 * Player profiles: your own page from the profile picture, editing it, the
 * players directory, another player's page with their showcase, wishlist and
 * collection, and starting a trade from there. Desktop and phone layouts.
 */
export async function verifyProfiles(browser: Browser, db: Database, origin: string) {
  const admin = (
    await db.query('SELECT id FROM accounts WHERE instance_admin=true ORDER BY created_at LIMIT 1')
  ).rows[0].id as string;
  const realm = await createRealm(db, admin, 'Profile browser fixture', {
    ...defaultConfig,
    startingGems: 5_000,
  });
  const password = randomBytes(24).toString('hex'),
    ownerEmail = `${randomUUID()}@example.test`,
    visitorEmail = `${randomUUID()}@example.test`;
  const owner = await provisionPlayer(db, realm, ownerEmail, password),
    visitor = await provisionPlayer(db, realm, visitorEmail, password);
  const open = async (player: string) => {
    const view = await getRealmView(db, player, realm);
    const pack = view.packs.find((item) => item.name === 'All Characters')!;
    const opening = await openPack(
      db,
      player,
      realm,
      pack.id,
      randomUUID(),
      view.configRevision,
      5,
    );
    if (!opening.ok) throw new Error('Fixture opening failed.');
    return opening;
  };
  const owned = await open(owner),
    theirs = await open(visitor);
  const revision = (await getRealmView(db, owner, realm)).configRevision;
  // The owner wishes for one of the visitor's characters and the other way round.
  await setWishlistEntry(db, owner, realm, theirs.characters[0].id, true, randomUUID(), revision);
  await setWishlistEntry(db, visitor, realm, owned.characters[1].id, true, randomUUID(), revision);
  const ownerCode = (await getRealmView(db, owner, realm)).tradeCode,
    ownerName = `Player ${ownerCode.slice(0, 6)}`;
  const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    visitorContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  for (const context of [ownerContext, visitorContext])
    await context.route('**/*', (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
  try {
    const page = await ownerContext.newPage(),
      phone = await visitorContext.newPage();
    const errors: Error[] = [];
    page.on('pageerror', (error) => errors.push(error));
    phone.on('pageerror', (error) => errors.push(error));
    for (const [context, email] of [
      [ownerContext, ownerEmail],
      [visitorContext, visitorEmail],
    ] as const)
      expect(
        (
          await context.request.post(`${origin}/api/login`, {
            headers: { Origin: origin },
            data: { email, password },
          })
        ).status(),
      ).toBe(200);

    // The profile picture opens your own page; the arrow next to it still opens the menu.
    await page.goto(`${origin}/packs?realm=${realm}`);
    await page.getByRole('link', { name: 'Your profile', exact: true }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/profile');
    await expect(page.getByRole('heading', { level: 1, name: ownerName })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Most valuable cards' })).toBeVisible();
    await expect(page.locator('#profile .profile-stats')).toContainText('5');
    // Your own wishlist is shown to you with a note that others don't see it.
    await expect(page.locator('#profile')).toContainText('Only you see this.');
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await expect(
      page.locator('.account-panel').getByRole('link', { name: 'Players', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();

    // Edit: text, colour, two showcase cards and the wishlist switch.
    await page.getByRole('button', { name: 'Edit profile', exact: true }).click();
    const editor = page.getByRole('form', { name: 'Edit profile' });
    await editor.getByLabel('About you').fill('Looking for wayfinders. Open to trades.');
    await editor.getByText('Ocean', { exact: true }).click();
    await editor.getByRole('button', { name: /^Choose cards/ }).click();
    const picker = page.getByRole('dialog', { name: 'Choose showcase cards', exact: true });
    for (const index of [2, 0])
      await picker
        .getByRole('button', { name: `Select ${owned.characters[index].name}`, exact: true })
        .click();
    await picker.getByRole('button', { name: 'Use 2 selected cards', exact: true }).click();
    await editor.getByLabel(/^Show my wishlist/).check();
    await editor.getByRole('button', { name: 'Save profile', exact: true }).click();
    await expect(page.locator('#profile').getByRole('status').first()).toHaveText('Profile saved.');
    await expect(page.locator('.profile-hero')).toHaveClass(/profile-theme-ocean/);
    await expect(page.locator('.profile-bio')).toHaveText(
      'Looking for wayfinders. Open to trades.',
    );
    const showcase = page.getByRole('region', { name: 'Showcase', exact: true });
    await expect(showcase.locator('.profile-card h3')).toHaveText([
      owned.characters[2].name,
      owned.characters[0].name,
    ]);
    expect((await getPlayerProfile(db, visitor, realm, ownerCode)).page).toMatchObject({
      theme: 'ocean',
      showcase: [owned.cardIds[2], owned.cardIds[0]],
      showWishlist: true,
    });
    await page.screenshot({ path: '.test-data/profile-own-desktop.png', fullPage: true });

    // Players (the tab on the profile page): everyone in the realm, the viewer
    // marked. The top navigation has no Players item.
    await expect(
      page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', {
        name: 'Players',
      }),
    ).toHaveCount(0);
    await page
      .getByRole('group', { name: 'Profiles' })
      .getByRole('link', { name: 'Players', exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Players' })).toBeVisible();
    await expect(page.locator('.player-row')).toHaveCount(3);
    await expect(page.locator('.player-row').filter({ hasText: 'You' })).toContainText(ownerName);
    await page.getByLabel('Search players').fill('nobody by this name');
    await expect(page.getByRole('heading', { name: 'No players found.' })).toBeVisible();

    // The visitor (phone) finds the owner through the account menu and the directory.
    await phone.goto(`${origin}/packs?realm=${realm}`);
    // The menu opens once the page is interactive.
    await expect(async () => {
      const panel = await openAccountMenu(phone);
      await expect(panel.getByRole('link', { name: 'Players', exact: true })).toBeVisible({
        timeout: 1000,
      });
    }).toPass();
    await phone
      .locator('.account-panel')
      .getByRole('link', { name: 'Players', exact: true })
      .click();
    await phone.getByLabel('Search players').fill(ownerCode);
    await expect(phone.locator('.player-row')).toHaveCount(1);
    await phone.locator('.player-row').click();
    await expect(phone.getByRole('heading', { level: 1, name: ownerName })).toBeVisible();
    const theirPage = phone.locator('#profile');
    await expect(theirPage.locator('.profile-bio')).toHaveText(
      'Looking for wayfinders. Open to trades.',
    );
    await expect(theirPage).not.toContainText('Edit profile');
    // Matches both ways: they hold a card the visitor wishes for, and wish for one the visitor holds.
    await expect(
      theirPage.getByRole('region', { name: 'On your wishlist' }).locator('.profile-card h3'),
    ).toHaveText([owned.characters[1].name]);
    const wishes = theirPage.getByRole('region', { name: 'Wishlist', exact: true });
    await expect(wishes.locator('.profile-card h3')).toHaveText([theirs.characters[0].name]);
    await expect(wishes).toContainText('You own this card');
    // No horizontal overflow on the phone.
    expect(
      await phone.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await phone.screenshot({ path: '.test-data/profile-other-phone.png', fullPage: true });
    await theirPage.getByRole('button', { name: 'Browse all 5 cards', exact: true }).click();
    await expect(theirPage.locator('.profile-collection .profile-card')).toHaveCount(5);
    await theirPage.getByLabel('Search this collection').fill(owned.characters[3].name);
    await expect(theirPage.locator('.profile-collection .profile-card')).toHaveCount(1);

    // Propose a trade: the Trades screen opens a new offer to that player.
    await theirPage.getByRole('link', { name: 'Propose a trade', exact: true }).click();
    await expect.poll(() => new URL(phone.url()).pathname).toBe('/trades');
    const composer = phone.getByRole('region', { name: 'New trade', exact: true });
    await expect(composer.getByLabel('Other player’s trade ID')).toHaveValue(ownerCode);
    await expect(composer.getByRole('region', { name: /^You get from / })).toBeVisible();

    // A player who is not in this realm has no page here.
    await phone.goto(`${origin}/profile?realm=${realm}&player=${randomUUID()}`);
    await expect(
      phone.getByRole('heading', { name: 'This profile is not available.' }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await ownerContext.close();
    await visitorContext.close();
  }
}
