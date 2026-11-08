import { randomBytes, randomUUID } from 'node:crypto';
import { expect, type Browser } from '@playwright/test';
import { provisionPlayer, type Database } from '../../packages/db/src/index';
import { openAccountMenu } from './screen-browser';

// Separate generated accounts keep the existing gameplay and Discord fixtures intact.
export async function verifyPasswordChanges(
  browser: Browser,
  db: Database,
  origin: string,
  realmId: string,
) {
  const email = `${randomUUID()}@example.test`,
    old = randomBytes(24).toString('hex'),
    next = randomBytes(24).toString('hex');
  await provisionPlayer(db, realmId, email, old);
  const owner = await browser.newContext({ viewport: { width: 375, height: 812 } }),
    other = await browser.newContext(),
    anonymous = await browser.newContext();
  for (const context of [owner, other, anonymous])
    await context.route('**/*', (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
  try {
    const page = await owner.newPage(),
      second = await other.newPage();
    async function signIn(target: typeof page, password: string) {
      await target.goto(origin);
      await target.getByLabel('Email address', { exact: true }).fill(email);
      await target.getByLabel('Password', { exact: true }).fill(password);
      await target.getByRole('button', { name: /^Sign in/ }).click();
      await expect(target.getByRole('button', { name: 'Account menu', exact: true })).toBeVisible();
    }
    await signIn(page, old);
    await signIn(second, old);
    await openAccountMenu(page);
    await page.getByRole('link', { name: 'Account settings', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Account settings' });
    await expect(panel).toBeVisible();
    const current = panel.getByLabel('Current password', { exact: true }),
      fresh = panel.getByLabel('New password', { exact: true }),
      confirmation = panel.getByLabel('Confirm new password', { exact: true });
    await current.fill(old);
    await fresh.fill(next);
    await confirmation.fill(old);
    await panel.getByRole('button', { name: 'Change password', exact: true }).click();
    await expect(panel.getByRole('alert')).toHaveText('The new passwords do not match.');
    await current.fill('incorrect-fixture-password');
    await confirmation.fill(next);
    await panel.getByRole('button', { name: 'Change password', exact: true }).click();
    await expect(panel.getByRole('alert')).toHaveText('Your current password is incorrect.');
    await expect(current).toHaveValue('');
    await expect(fresh).toHaveValue('');
    await current.fill(old);
    await fresh.fill(next);
    await confirmation.fill(next);
    const attempts: Record<string, unknown>[] = [];
    await page.route('**/api/account/password', async (route) => {
      attempts.push(route.request().postDataJSON());
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (attempts.length === 1) await route.abort('failed');
      else await route.fulfill({ response });
    });
    await panel.getByRole('button', { name: 'Change password', exact: true }).click();
    await expect(
      panel.getByRole('button', { name: 'Retry password change', exact: true }),
    ).toBeVisible();
    await expect(current).toBeDisabled();
    await second.reload();
    await expect(second.getByRole('button', { name: /^Sign in/ })).toBeVisible();
    await signIn(second, next); // A later session must survive receipt recovery.
    await panel.getByRole('button', { name: 'Retry password change', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('Password is already current.');
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    await expect(current).toHaveValue('');
    await expect(fresh).toHaveValue('');
    await expect(confirmation).toHaveValue('');
    await second.reload();
    await expect(second.getByRole('button', { name: 'Account menu', exact: true })).toBeVisible();
    await page.unroute('**/api/account/password');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      (
        await anonymous.request.post(`${origin}/api/account/password`, {
          headers: { Origin: origin },
          data: {},
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await owner.request.post(`${origin}/api/account/password`, {
          headers: { Origin: 'https://untrusted.example.test' },
          data: {},
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await owner.request.post(`${origin}/api/account/password`, {
          headers: { Origin: origin },
          data: { currentPassword: next, newPassword: old },
        })
      ).status(),
    ).toBe(400);
    // A second change uses the refreshed revision, then revokes that later session.
    await current.fill(next);
    await fresh.fill(old);
    await confirmation.fill(old);
    await panel.getByRole('button', { name: 'Change password', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText(
      'Password changed. Other sessions were signed out.',
    );
    await second.reload();
    await expect(second.getByRole('button', { name: /^Sign in/ })).toBeVisible();
    await page.screenshot({ path: '.test-data/password-settings-mobile.png' });
    await panel.getByRole('button', { name: 'Close account settings' }).click();
    await expect(panel).toHaveCount(0);
  } finally {
    await owner.close();
    await other.close();
    await anonymous.close();
  }
}
