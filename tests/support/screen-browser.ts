import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
const names = {
  packs: /^Packs$/,
  collection: /^Collection/,
  market: /^Market$/,
  trades: /^Trades$/,
  ranks: /^Ranks$/,
  wishlist: /^Wishlist$/,
  admin: /^Administration$/,
  account: /^Account settings$/,
};
/** Administration, account settings, the admin-view switch and sign-out live in the account menu. */
export async function openAccountMenu(page: Page) {
  const trigger = page.getByRole('button', { name: 'Account menu', exact: true });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  return page.locator('.account-panel');
}
export async function closeAccountMenu(page: Page) {
  const trigger = page.getByRole('button', { name: 'Account menu', exact: true });
  if ((await trigger.getAttribute('aria-expanded')) === 'true') await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
}
export async function showScreen(page: Page, screen: keyof typeof names) {
  const opening = page.locator('.opening-room-stage');
  if (await opening.isVisible()) {
    await opening.getByRole('button', { name: /^Return to pack$/ }).click();
    await expect(opening).toHaveCount(0);
  }
  const studioBack = page
    .locator('.pack-studio')
    .getByRole('link', { name: 'All packs', exact: true });
  if (await studioBack.isVisible()) {
    await expect(studioBack).not.toHaveAttribute('aria-disabled', 'true');
    await studioBack.click();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  }
  const current = new URL(page.url());
  const menuScreen = screen === 'admin' || screen === 'account';
  if (
    current.pathname !== `/${screen}` ||
    (screen === 'packs' && current.searchParams.has('pack'))
  ) {
    // Receipts/listings can render before their final refresh settles. The
    // global pending-operation guard must release before ordinary navigation.
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByRole('link', { name: names.packs })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    if (menuScreen) {
      const menu = await openAccountMenu(page);
      await menu.getByRole('link', { name: names[screen] }).click();
    } else await nav.getByRole('link', { name: names[screen] }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/${screen}`);
    if (screen === 'packs')
      await expect.poll(() => new URL(page.url()).searchParams.has('pack')).toBe(false);
  }
  if (menuScreen) {
    const menu = await openAccountMenu(page);
    await expect(menu.getByRole('link', { name: names[screen] })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await closeAccountMenu(page);
  } else
    await expect(
      page
        .getByRole('navigation', { name: 'Main navigation' })
        .getByRole('link', { name: names[screen] }),
    ).toHaveAttribute('aria-current', 'page');
}
export async function choosePack(page: Page, name = 'All Characters') {
  const detail = page.locator('.pack-detail');
  if (!(await detail.getByRole('heading', { name, exact: true }).isVisible())) {
    await showScreen(page, 'packs');
    await page.getByRole('link', { name: `Explore ${name}`, exact: true }).click();
  }
  await expect(detail.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.has('pack')).toBe(true);
  return detail;
}
export function adminSection(page: Page, name: string) {
  return page
    .getByRole('navigation', { name: 'Administration sections' })
    .getByRole('button', { name: new RegExp(`^${name}`) });
}
export async function openAdminCreate(page: Page) {
  await showScreen(page, 'admin');
  if (!(await page.getByLabel('Realm name', { exact: true }).isVisible())) {
    if (!(await page.getByRole('list', { name: 'Realm creation steps' }).isVisible()))
      await adminSection(page, 'New realm').click();
    await realmWizardStep(page, 'Name');
  }
  await expect(page.getByLabel('Realm name', { exact: true })).toBeVisible();
}
/** Jumps to one step of the create-realm wizard (all steps stay mounted). */
export async function realmWizardStep(
  page: Page,
  step: 'Name' | 'Characters' | 'Packs' | 'Rules' | 'Review',
) {
  const button = page
    .getByRole('list', { name: 'Realm creation steps' })
    .getByRole('button', { name: step });
  await button.click();
  await expect(button).toHaveAttribute('aria-current', 'step');
}
export async function chooseRealmContent(page: Page, value: 'provider' | 'custom' | 'csv') {
  await realmWizardStep(page, 'Characters');
  await page.locator(`input[name="catalog-kind"][value="${value}"]`).check();
}
/** Uploads the original 12-character demo catalog (also offered as a download). */
export async function chooseDemoCatalog(page: Page) {
  await chooseRealmContent(page, 'custom');
  await page
    .getByLabel('Original catalog JSON file', { exact: true })
    .setInputFiles(
      fileURLToPath(new URL('../../packages/importers/fixtures/demo.v1.json', import.meta.url)),
    );
  await page
    .getByRole('checkbox', {
      name: 'I created this content and have permission to use it, or have a license for this catalog.',
      exact: true,
    })
    .check();
}
/** Switches the rule category inside the wizard's "Customize gameplay rules". */
export async function rulesTab(
  page: Page,
  name: 'Economy' | 'Collection' | 'Progression' | 'Collector ranks' | 'Trading',
) {
  const tab = page
    .getByRole('tablist', { name: 'Rule categories' })
    .getByRole('tab', { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}
