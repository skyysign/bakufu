import { randomUUID } from 'node:crypto';
import { expect, type Browser, type Locator } from '@playwright/test';
import { defaultConfig } from '../../packages/config/src/index';
import {
  createRealm,
  getRealmView,
  linkDiscordAccount,
  openPack,
  previewRealmCatalog,
  provisionPlayer,
  recentPulls,
  type Database,
} from '../../packages/db/src/index';
import { providerCharacterId } from '../../packages/importers/src/providers';

/** An original, provider-shaped roster large enough for many rare-and-above pulls. */
function originalRoster(count: number) {
  return {
    schemaVersion: 1,
    source: 'mal',
    revision: 'original-live-pulls-fixture',
    license: 'Original fictional provider-shaped fixture, MIT',
    characters: Array.from({ length: count }, (_, index) => ({
      id: providerCharacterId('mal', 910000000 + index),
      sourceKey: `mal:${910000000 + index}`,
      name: `Original Strip Courier ${String(index).padStart(3, '0')}`,
      series: `Original Strip Series ${index % 40}`,
      categories: ['Action'],
      popularity: count - index,
    })),
  };
}

/** Which pulls are fully inside the visible row, and how many are loaded. */
function rowState(live: Locator) {
  return live.evaluate((section) => {
    const list = section.querySelector('.pull-grid') as HTMLElement;
    const box = list.getBoundingClientRect(),
      inset = parseFloat(getComputedStyle(list).paddingLeft) || 0;
    const items = Array.from(list.children) as HTMLElement[];
    const visible = items.filter((item) => {
      const rect = item.getBoundingClientRect();
      return rect.left >= box.left + inset - 2 && rect.right <= box.right - inset + 2;
    });
    // Cards cut off at the row's edges (none at rest: no slivers of the next card).
    const partial = items.filter((item) => {
      const rect = item.getBoundingClientRect();
      return rect.right > box.left + 0.5 && rect.left < box.right - 0.5;
    }).length;
    // The row and its buttons stay on screen.
    const edges = [list, ...Array.from(section.querySelectorAll('.pull-nav'))].map((element) =>
      element.getBoundingClientRect(),
    );
    return {
      first: visible[0]?.dataset.key,
      shown: visible.length,
      partial: partial - visible.length,
      loaded: items.length,
      scrollbar: getComputedStyle(list).scrollbarWidth,
      rowFits: edges.every(
        (rect) => rect.left >= 0 && rect.right <= document.documentElement.clientWidth,
      ),
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
}

/**
 * Packs → Live pulls in a real browser: one row with the usual number of cards
 * and no scrollbar; side buttons (on hover, keyboard focus, or always on touch
 * screens) page back and load older pulls a page at a time; new pulls arriving
 * while scrolled back keep the row in place; cards name who owns them.
 */
export async function verifyLivePulls(
  browser: Browser,
  db: Database,
  origin: string,
  admin: string,
  email: string,
  password: string,
) {
  // Enough for 30 ten-pack openings each; a realistic balance keeps the phone header narrow.
  const config = { ...defaultConfig, startingGems: 60_000, cooldownSeconds: 0 };
  const catalog = { data: originalRoster(400), rightsConfirmed: true };
  const preview = await previewRealmCatalog(db, admin, config, catalog);
  const realm = await createRealm(
    db,
    admin,
    'Live pulls browser fixture',
    config,
    catalog,
    preview.fingerprint,
  );
  const playerEmail = `live-pulls-${randomUUID()}@example.test`;
  const player = await provisionPlayer(db, realm, playerEmail, password);
  await linkDiscordAccount(db, playerEmail, '500000000000004242');
  await db.query(
    'INSERT INTO discord_profiles(account_id,username,display_name) VALUES($1,$2,$3)',
    [player, 'original_strip_collector', 'Original Strip Collector'],
  );
  const pack = (await getRealmView(db, admin, realm)).packs.find(
    (candidate) => candidate.category === null,
  )!;
  const open = async (actor: string) => {
    const view = await getRealmView(db, actor, realm);
    const result = await openPack(db, actor, realm, pack.id, randomUUID(), view.configRevision, 10);
    if (!result.ok) throw new Error('Live pulls fixture opening failed.');
  };
  const notable = async () => (await recentPulls(db, admin, realm, { limit: 48 })).pulls;
  for (let opening = 0; opening < 40 && (await notable()).length < 30; opening++)
    await open(opening % 2 ? admin : player);
  const all = await notable();
  expect(all.length).toBeGreaterThanOrEqual(30);
  const playersPull = all.find((pull) => !pull.mine)!;

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    await desktop.route('**/*', (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
    expect(
      (
        await desktop.request.post(`${origin}/api/login`, {
          headers: { Origin: origin },
          data: { email, password },
        })
      ).status(),
    ).toBe(200);
    const page = await desktop.newPage();
    await page.goto(`${origin}/packs?realm=${realm}`);
    const live = page.getByRole('region', { name: 'Live pulls', exact: true });
    const newer = live.getByRole('button', { name: 'Show newer pulls', exact: true }),
      older = live.getByRole('button', { name: /^(Show|Loading) older pulls$/ });
    await expect(live.locator('.pull-item')).toHaveCount(12);
    // The same six cards as before, no scrollbar and no sideways page scroll.
    expect(await rowState(live)).toMatchObject({
      first: all[0].key,
      shown: 6,
      partial: 0,
      loaded: 12,
      scrollbar: 'none',
      rowFits: true,
      pageOverflow: false,
    });
    // The buttons appear only while the pointer is over the row.
    await page.mouse.move(5, 5);
    await expect(older).toHaveCSS('opacity', '0');
    await live.locator('.pull-item').nth(2).hover();
    await expect(older).toHaveCSS('opacity', '1');
    await expect(newer).toHaveAttribute('aria-disabled', 'true');
    await expect(newer).toHaveCSS('opacity', '0');
    // Older: the next six; the following page loads before it is reached.
    await older.click();
    await expect.poll(async () => (await rowState(live)).first).toBe(all[6].key);
    await expect(live.locator('.pull-item')).toHaveCount(24);
    await expect(newer).toHaveCSS('opacity', '1');
    await older.click();
    await expect.poll(async () => (await rowState(live)).first).toBe(all[12].key);
    await newer.click();
    await expect.poll(async () => (await rowState(live)).first).toBe(all[6].key);
    // New pulls while scrolled back: the row stays on the same cards.
    const before = all.length,
      known = new Set(all.map((pull) => pull.key));
    const newPulls = async () =>
      (await recentPulls(db, admin, realm)).pulls.filter((pull) => !known.has(pull.key)).length;
    for (let opening = 0; opening < 10 && (await newPulls()) === 0; opening++) await open(player);
    const added = await newPulls();
    expect(added).toBeGreaterThan(0);
    await expect(live.locator('.pull-grid')).not.toHaveAttribute('aria-busy', 'true');
    const loadedBefore = (await rowState(live)).loaded;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(live.locator('.pull-item')).toHaveCount(loadedBefore + added);
    expect((await rowState(live)).first).toBe(all[6].key);
    // Paging to the very end loads every older pull; then "older" stays dimmed.
    for (let clicks = 0; clicks < 12; clicks++) {
      if ((await older.getAttribute('aria-disabled')) === 'true') break;
      await older.click();
      await page.waitForTimeout(450);
    }
    await expect(older).toHaveAttribute('aria-disabled', 'true');
    expect((await rowState(live)).loaded).toBe(before + added);
    // Keyboard: a focused button shows without hovering.
    await page.mouse.move(5, 5);
    await live.locator('.pull-item').last().getByRole('button').first().focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(older).toBeFocused();
    await expect(older).toHaveCSS('opacity', '0.45');
    // A card owned by another member names them.
    await page.evaluate(() => document.querySelector('.pull-grid')!.scrollTo({ left: 0 }));
    const owned = live.locator(`.pull-item[data-key="${playersPull.key}"]`);
    await owned.scrollIntoViewIfNeeded();
    await owned.getByRole('button', { name: `Inspect ${playersPull.name}`, exact: true }).click();
    const details = page.getByRole('dialog', { name: `${playersPull.name} card details` });
    await expect(details).toContainText('Owned by Original Strip Collector');
    await details.getByRole('button', { name: 'Close card inspection' }).click();
    await expect(details).toBeHidden();
  } finally {
    await desktop.close();
  }

  // Phone: three cards in one row; touch screens show the buttons at all times.
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  try {
    await phone.route('**/*', (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
    expect(
      (
        await phone.request.post(`${origin}/api/login`, {
          headers: { Origin: origin },
          data: { email, password },
        })
      ).status(),
    ).toBe(200);
    const page = await phone.newPage();
    await page.goto(`${origin}/packs?realm=${realm}`);
    const live = page.getByRole('region', { name: 'Live pulls', exact: true });
    const older = live.getByRole('button', { name: /^(Show|Loading) older pulls$/ });
    const newest = await notable();
    await expect(live.locator('.pull-item')).toHaveCount(12);
    expect(await rowState(live)).toMatchObject({
      first: newest[0].key,
      shown: 3,
      partial: 0,
      scrollbar: 'none',
      rowFits: true,
      pageOverflow: false,
    });
    await expect(older).toHaveCSS('opacity', '1');
    await older.tap();
    await expect.poll(async () => (await rowState(live)).first).toBe(newest[3].key);
    await expect.poll(async () => (await rowState(live)).partial).toBe(0);
    expect(await rowState(live)).toMatchObject({ rowFits: true, pageOverflow: false });
  } finally {
    await phone.close();
  }
}
