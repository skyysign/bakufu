import { randomUUID } from 'node:crypto';
import { expect, type Browser } from '@playwright/test';
import { defaultConfig } from '../../packages/config/src/index';
import {
  createRealm,
  getRealmView,
  provisionPlayer,
  type Database,
} from '../../packages/db/src/index';
import { closeAccountMenu, openAccountMenu } from './screen-browser';

/**
 * Administration → Players & access → Realm admins in a real browser: the
 * creator (desktop) finds a member and makes them an admin; that member (phone)
 * now has Administration and the game rules, cannot remove the creator, and
 * steps down again, which takes them back to the game.
 */
export async function verifyRealmAdmins(
  browser: Browser,
  db: Database,
  origin: string,
  admin: string,
  email: string,
  password: string,
) {
  const realm = await createRealm(db, admin, 'Realm admins browser fixture', defaultConfig);
  const friendEmail = `realm-admin-${randomUUID()}@example.test`,
    friend = await provisionPlayer(db, realm, friendEmail, password),
    friendCode = (await getRealmView(db, friend, realm)).tradeCode;
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 960 } }),
    phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  for (const context of [desktop, phoneContext])
    await context.route('**/*', (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
  try {
    for (const [context, login] of [
      [desktop, email],
      [phoneContext, friendEmail],
    ] as const)
      expect(
        (
          await context.request.post(`${origin}/api/login`, {
            headers: { Origin: origin },
            data: { email: login, password },
          })
        ).status(),
      ).toBe(200);
    const page = await desktop.newPage(),
      phone = await phoneContext.newPage();
    const errors: Error[] = [];
    page.on('pageerror', (error) => errors.push(error));
    phone.on('pageerror', (error) => errors.push(error));

    // Before: the member has no Administration and the API refuses them.
    await phone.goto(`${origin}/admin?task=access&realm=${realm}`);
    await expect.poll(() => new URL(phone.url()).pathname).toBe('/packs');
    expect(
      (await phoneContext.request.get(`${origin}/api/realm-admins?realmId=${realm}`)).status(),
    ).toBe(403);
    expect(
      (
        await phoneContext.request.post(`${origin}/api/realm-admins`, {
          headers: { Origin: origin },
          data: { realmId: realm, tradeCode: friendCode, role: 'admin' },
        })
      ).status(),
    ).toBe(403);
    // Role changes are same-origin writes like every other one.
    expect(
      (
        await desktop.request.post(`${origin}/api/realm-admins`, {
          headers: { Origin: 'https://attacker.example' },
          data: { realmId: realm, tradeCode: friendCode, role: 'admin' },
        })
      ).status(),
    ).toBe(403);

    // The creator adds the member as an admin.
    await page.goto(`${origin}/admin?task=access&realm=${realm}`);
    const panel = page.getByRole('region', { name: 'Realm admins', exact: true });
    const list = panel.getByRole('list', { name: 'Current admins', exact: true });
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list).toContainText('Creator');
    await expect(list).toContainText('You');
    await expect(list.getByRole('button')).toHaveCount(0);
    const makeAdmin = panel.getByRole('button', { name: 'Make admin', exact: true });
    await expect(makeAdmin).toBeDisabled();
    await panel.getByLabel('Search realm members').fill(friendCode);
    const choice = panel.getByRole('radio', { name: `Choose Player (${friendCode})` });
    await choice.focus();
    await page.keyboard.press('Space');
    await expect(choice).toBeChecked();
    await makeAdmin.click();
    await expect(panel.getByRole('status').filter({ hasText: 'is now an admin.' })).toBeVisible();
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(
      list.getByRole('button', { name: 'Remove Player as admin', exact: true }),
    ).toBeVisible();
    await expect(panel.getByLabel('Member code (trade ID)', { exact: true })).toHaveValue('');

    // The new admin (phone) reaches Administration and the game rules.
    await phone.goto(`${origin}/packs?realm=${realm}`);
    const menu = await openAccountMenu(phone);
    await menu.getByRole('link', { name: 'Administration', exact: true }).click();
    await expect.poll(() => new URL(phone.url()).pathname).toBe('/admin');
    await phone.goto(`${origin}/admin?task=rules&realm=${realm}`);
    await expect(
      phone.getByRole('button', { name: 'Preview settings changes', exact: true }).first(),
    ).toBeVisible();
    await phone.goto(`${origin}/admin?task=access&realm=${realm}`);
    const phonePanel = phone.getByRole('region', { name: 'Realm admins', exact: true });
    const phoneList = phonePanel.getByRole('list', { name: 'Current admins', exact: true });
    await expect(phoneList.getByRole('listitem')).toHaveCount(2);
    // Only their own row has a button: the creator cannot be removed.
    await expect(phoneList.getByRole('button')).toHaveCount(1);
    const width = await phone.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
    await phoneList.getByRole('button', { name: 'Step down as admin', exact: true }).click();
    const confirm = phoneList.getByRole('group', { name: 'Confirm removal', exact: true });
    await expect(confirm).toContainText('You lose access to Administration');
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(confirm).toHaveCount(0);
    await phoneList.getByRole('button', { name: 'Step down as admin', exact: true }).click();
    await confirm.getByRole('button', { name: 'Step down', exact: true }).click();
    await expect.poll(() => new URL(phone.url()).pathname).toBe('/packs');
    await openAccountMenu(phone);
    await expect(phone.getByRole('link', { name: 'Administration', exact: true })).toHaveCount(0);
    await closeAccountMenu(phone);
    expect((await getRealmView(db, friend, realm)).role).toBe('player');
    expect(errors).toEqual([]);
  } finally {
    await desktop.close();
    await phoneContext.close();
  }
}
