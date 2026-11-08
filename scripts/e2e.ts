import { gzipSync } from 'node:zlib';
import {
  adminSection,
  chooseRealmContent,
  chooseDemoCatalog,
  rulesTab,
  choosePack,
  closeAccountMenu,
  openAccountMenu,
  openAdminCreate,
  realmWizardStep,
  showScreen,
} from '../tests/support/screen-browser';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import {
  bootstrap,
  createRealm as createRealmService,
  parsePlayerArchive,
  provisionPlayer,
  linkDiscordAccount,
  getRealmView,
  providerCatalogRequestBytes,
  openPack,
} from '../packages/db/src/index';
import {
  customCatalog,
  customChoice,
  csvCatalog,
  csvChoice,
  csvMetadata,
} from '../tests/support/catalog-fixture';
import { verifyProviderPipeline } from '../tests/support/providers-browser';
import { verifyBatchPlay } from '../tests/support/batch-browser';
import { verifyJikanBrowser } from '../tests/support/jikan-browser';
import { verifyRevealSoundsAdmin } from '../tests/support/reveal-sounds-browser';
import { verifyAdminCollections } from '../tests/support/admin-collections-browser';
import { verifyPlayerRework } from '../tests/support/rework-browser';
import { verifyPasswordChanges } from '../tests/support/password-browser';
import { verifyPackReveals } from '../tests/support/reveal-browser';
import { verifyRevealLoading } from '../tests/support/reveal-loading-browser';
import { verifyCollectionExperience } from '../tests/support/collection-experience-browser';
import { manualPlan } from '../tests/support/pack-plan-fixture';
import { defaultConfig } from '../tests/support/prototype-config';
import { defaultConfig as productConfig } from '../packages/config/src/index';
import { freePort, startPostgres } from '../tests/support/postgres';

// Programmatic regression realms explicitly retain their historical economy.
const createRealm: typeof createRealmService = (db, actor, name, config = defaultConfig, ...rest) =>
  createRealmService(db, actor, name, config, ...rest);

// Production-build browser test. Uses only a disposable local database and original fixtures.
const postgres = await startPostgres();
const { db, url } = await postgres.database('browser_test');
const password = randomBytes(24).toString('hex');
const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const admin = await bootstrap(db, 'browser-admin@example.test', password);
const discordAdmin = '100000000000000001';
const discordPlayer = '200000000000000001';
const signingKeys = generateKeyPairSync('ed25519');
const discordPublicKey = signingKeys.publicKey
  .export({ format: 'der', type: 'spki' })
  .subarray(-32)
  .toString('hex');
await linkDiscordAccount(db, 'browser-admin@example.test', discordAdmin);
const server = spawn(
  process.execPath,
  [
    '--import',
    pathToFileURL(resolve('tests/support/discord-provider.mjs')).href,
    resolve('apps/web/node_modules/next/dist/bin/next'),
    'start',
    '-p',
    String(port),
    '-H',
    '127.0.0.1',
  ],
  {
    cwd: resolve('apps/web'),
    windowsHide: true,
    env: {
      ...process.env,
      DATABASE_URL: url,
      APP_ORIGIN: origin,
      COOKIE_SECURE: 'false',
      NEXT_TELEMETRY_DISABLED: '1',
      DISCORD_CLIENT_ID: '900000000000000001',
      DISCORD_CLIENT_SECRET: randomBytes(24).toString('hex'),
      DISCORD_ADMIN_USER_ID: discordAdmin,
      DISCORD_PUBLIC_KEY: discordPublicKey,
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  },
);
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge' } : {});
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null)
      throw new Error('Production server exited. Run pnpm build before this test.');
    try {
      if ((await fetch(origin)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* server starting */
    }
    await delay(500);
  }
  if (!ready) throw new Error('Production server did not become ready.');
  // Hold client scripts: sign-in must not accept an inert click or native GET credentials.
  const delayedContext = await browser.newContext();
  let releaseScripts!: () => void;
  const scriptsReady = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  await delayedContext.route('**/*', async (route) => {
    const target = new URL(route.request().url());
    if (target.origin !== origin) return route.abort();
    if (target.pathname.endsWith('.js')) await scriptsReady;
    await route.continue();
  });
  try {
    const delayedPage = await delayedContext.newPage();
    await delayedPage.goto(origin, { waitUntil: 'commit' });
    await expect(delayedPage.getByRole('heading', { name: 'Sign in to Bakufu' })).toBeVisible();
    await expect(delayedPage.getByLabel('Email address')).toBeDisabled();
    await expect(delayedPage.getByLabel('Password', { exact: true })).toBeDisabled();
    await expect(delayedPage.getByRole('button', { name: 'Continue with Discord' })).toBeDisabled();
    await expect(delayedPage.locator('form')).toHaveAttribute('method', 'post');
    releaseScripts();
    await delayedPage.waitForLoadState('load');
    await expect(delayedPage.getByLabel('Password', { exact: true })).toBeEnabled();
    await expect(delayedPage.getByRole('button', { name: 'Continue with Discord' })).toBeEnabled();
  } finally {
    releaseScripts();
    await delayedContext.close();
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  const page = await context.newPage();
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: 'Sign in to Bakufu' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Discord' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.getByLabel('Email address').fill('browser-admin@example.test');
  await page.getByLabel('Password', { exact: true }).fill('an-incorrect-test-password');
  await page.getByRole('button', { name: 'Sign in →' }).click();
  await expect(page.locator('p[role="alert"]')).toHaveText('Email or password is incorrect.');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in →' }).click();
  await openAdminCreate(page);
  await page.getByLabel('Realm name').fill('Browser demo realm');
  // The roster source is the default; the original demo catalog is uploaded as JSON.
  await realmWizardStep(page, 'Characters');
  await expect(page.locator('input[name="catalog-kind"][value="provider"]')).toBeChecked();
  await expect(page.locator('input[name="catalog-kind"]')).toHaveCount(3);
  await chooseDemoCatalog(page);
  await realmWizardStep(page, 'Rules');
  await page.getByText('Customize gameplay rules', { exact: true }).click();
  await rulesTab(page, 'Collection');
  await expect(
    page.getByRole('spinbutton', { name: 'Common base value', exact: true }),
  ).toHaveValue(String(productConfig.recycleRewards.common));
  await expect(page.getByRole('button', { name: 'Use recommended values' })).toHaveCount(0);
  const configuredRewards = { Common: 3, Uncommon: 5, Rare: 7, Epic: 11, Legendary: 29 };
  for (const [tier, reward] of Object.entries(configuredRewards))
    await page
      .getByRole('spinbutton', { name: `${tier} base value`, exact: true })
      .fill(String(reward));
  await expect(page.getByRole('button', { name: 'Use recommended values' })).toBeVisible();
  await expect(page.getByLabel('Wishlist slots', { exact: true })).toHaveValue('3');
  await page.getByLabel('Wishlist slots', { exact: true }).fill('2');
  await page.getByLabel('Wishlist weight multiplier', { exact: true }).fill('3');
  await rulesTab(page, 'Progression');
  await expect(page.getByLabel('XP per new character', { exact: true })).toHaveValue('10');
  await page.getByLabel('XP per new character', { exact: true }).fill('7');
  await page.getByLabel('Level thresholds', { exact: true }).fill('0, 7, 21');
  await realmWizardStep(page, 'Packs');
  await page.getByRole('button', { name: 'Preview catalog and packs' }).click();
  await expect(page.getByRole('region', { name: 'Catalog preview', exact: true })).toContainText(
    '12 characters; 6 starter packs',
  );
  await realmWizardStep(page, 'Review');
  await expect(page.locator('.wizard-summary')).toContainText('Browser demo realm');
  await expect(page.locator('.wizard-summary')).toContainText('Customized');
  await page.getByRole('button', { name: 'Create realm', exact: true }).click();
  await page.waitForURL(/realm=/);
  const realmId = new URL(page.url()).searchParams.get('realm')!;
  await verifyPackReveals(context, db, admin, origin);
  await choosePack(page);
  await expect(page.getByLabel('Show card reveals', { exact: true })).toBeChecked();
  await page.getByLabel('Show card reveals', { exact: true }).uncheck();
  // Custom catalog browser flow shares only fixture auth, never live content.
  const catalogPage = await context.newPage();
  await catalogPage.goto(origin);
  await openAdminCreate(catalogPage);
  await catalogPage.getByLabel('Realm name').fill('Browser original workshop');
  await chooseRealmContent(catalogPage, 'custom');
  const upload = catalogPage.getByLabel('Original catalog JSON file');
  await upload.setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{invalid'),
  });
  await expect(
    catalogPage.getByRole('alert').filter({ hasText: 'Choose a valid JSON' }),
  ).toBeVisible();
  await upload.setInputFiles({
    name: 'workshop.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(customCatalog)),
  });
  await expect(
    catalogPage.getByRole('button', { name: 'Preview catalog and packs' }),
  ).toBeDisabled();
  await catalogPage.getByLabel('I created this content and have permission').check();
  await catalogPage.getByRole('button', { name: 'Preview catalog and packs' }).click();
  const catalogReview = catalogPage.getByRole('region', { name: 'Catalog preview', exact: true });
  await expect(catalogReview).toContainText('4 characters; 3 starter packs');
  await catalogReview.getByText('Review characters and assigned tiers').click();
  await expect(
    catalogReview.getByRole('cell', { name: 'workshop:vale', exact: true }),
  ).toBeVisible();
  await catalogPage.setViewportSize({ width: 390, height: 844 });
  expect(
    await catalogPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await realmWizardStep(catalogPage, 'Rules');
  await catalogPage.getByText('Customize gameplay rules', { exact: true }).click();
  await rulesTab(catalogPage, 'Progression');
  await catalogPage.getByLabel('XP per new character', { exact: true }).fill('8');
  await expect(catalogReview).toHaveCount(0);
  await realmWizardStep(catalogPage, 'Packs');
  await catalogPage.getByRole('button', { name: 'Preview catalog and packs' }).click();
  await catalogPage.getByLabel('Maximum category packs').fill('1');
  await catalogPage.getByLabel('Category pack selection').selectOption('manual');
  await catalogPage
    .getByRole('checkbox', { name: 'paper makers (2 characters)', exact: true })
    .check();
  await expect(
    catalogPage.getByRole('checkbox', { name: 'wind walkers (2 characters)', exact: true }),
  ).toBeDisabled();
  await catalogPage.getByLabel('Pack name for paper makers').fill('All Characters');
  await catalogPage.getByRole('button', { name: 'Preview catalog and packs' }).click();
  await expect(
    catalogPage.getByRole('alert').filter({ hasText: 'All Characters is reserved' }),
  ).toBeVisible();
  await catalogPage.getByLabel('Pack name for paper makers').fill('Paper Trail');
  await catalogPage.getByRole('button', { name: 'Preview catalog and packs' }).click();
  await expect(catalogReview).toContainText('4 characters; 2 starter packs');
  await expect(catalogReview).toContainText('Paper Trail');
  await catalogPage.getByLabel('Search catalog categories').fill('wind');
  await expect(catalogReview).toBeVisible();
  await expect(catalogPage.getByLabel('Pack name for paper makers')).toHaveValue('Paper Trail');
  await catalogPage.getByLabel('Search catalog categories').fill('');
  // Changing the source file deliberately clears manual choices and the old review.
  await realmWizardStep(catalogPage, 'Characters');
  await upload.setInputFiles({
    name: 'workshop-again.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(customCatalog)),
  });
  await expect(catalogPage.getByLabel('Category pack selection')).toHaveValue('automatic');
  await expect(catalogReview).toHaveCount(0);
  await catalogPage.getByRole('button', { name: 'Preview catalog and packs' }).click();
  await catalogPage.getByLabel('Category pack selection').selectOption('manual');
  await catalogPage
    .getByRole('checkbox', { name: 'paper makers (2 characters)', exact: true })
    .check();
  await catalogPage.getByLabel('Pack name for paper makers').fill('Paper Trail');
  await catalogPage.getByRole('button', { name: 'Preview catalog and packs' }).click();
  await expect(catalogReview).toContainText('4 characters; 2 starter packs');
  const creationRequests: Record<string, unknown>[] = [];
  let originalCreationId = '';
  await catalogPage.route('**/api/realms', async (route) => {
    creationRequests.push(route.request().postDataJSON());
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    if (creationRequests.length === 1) {
      originalCreationId = (await response.json()).id;
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  await realmWizardStep(catalogPage, 'Review');
  await catalogPage.getByRole('button', { name: 'Create realm', exact: true }).click();
  await expect(catalogPage.getByRole('button', { name: 'Retry realm creation' })).toBeVisible();
  await expect(catalogPage.getByLabel('Realm name')).toBeDisabled();
  await expect(adminSection(catalogPage, 'Overview')).toBeDisabled();
  await catalogPage.getByRole('button', { name: 'Retry realm creation' }).click();

  await catalogPage.waitForURL(
    (url) => url.pathname === '/packs' && url.searchParams.get('realm') === originalCreationId,
  );
  const customRealmId = new URL(catalogPage.url()).searchParams.get('realm')!;
  expect(customRealmId).toBe(originalCreationId);
  expect(creationRequests).toHaveLength(2);
  expect(creationRequests[1]).toEqual(creationRequests[0]);
  expect(
    (await db.query('SELECT 1 FROM realm_creation_requests WHERE realm_id=$1', [customRealmId]))
      .rowCount,
  ).toBe(1);
  expect(
    (await db.query('SELECT 1 FROM wallet_ledger WHERE realm_id=$1', [customRealmId])).rowCount,
  ).toBe(1);
  await catalogPage.unroute('**/api/realms');
  expect(
    (
      await context.request.post(`${origin}/api/realms`, {
        headers: { Origin: origin },
        data: { name: 'Missing key' },
      })
    ).status(),
  ).toBe(400);

  expect((await getRealmView(db, admin, customRealmId)).catalog.map((c) => c.id).sort()).toEqual(
    customCatalog.characters.map((c) => c.id).sort(),
  );
  await expect(catalogPage.locator('.pack')).toHaveCount(2);
  const customPacks = (
    await db.query('SELECT name,category FROM packs WHERE realm_id=$1 ORDER BY name', [
      customRealmId,
    ])
  ).rows;
  expect(customPacks).toEqual([
    { name: 'All Characters', category: null },
    { name: 'Paper Trail', category: 'paper makers' },
  ]);

  await openAdminCreate(catalogPage);
  await catalogPage.getByLabel('Realm name').fill('Browser CSV workshop');
  await chooseRealmContent(catalogPage, 'csv');
  const csvUpload = catalogPage.getByLabel('Original catalog CSV file');
  await csvUpload.setInputFiles({
    name: 'wrong-encoding.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from([255, 254, 0, 0]),
  });
  await expect(
    catalogPage.getByRole('alert').filter({ hasText: 'Choose a UTF-8 CSV file' }),
  ).toBeVisible();
  await csvUpload.setInputFiles({
    name: 'invalid.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('id,name\nprivate-submitted-test-value'),
  });
  await catalogPage.getByLabel('CSV source namespace').fill(csvMetadata.source);
  await catalogPage.getByLabel('CSV revision', { exact: true }).fill(csvMetadata.revision);
  await catalogPage.getByLabel('CSV permission statement').fill(csvMetadata.license);
  await catalogPage.getByLabel('I created this content and have permission').check();
  await catalogPage.getByRole('button', { name: 'Preview catalog and packs' }).click();
  await expect(catalogPage.getByRole('alert').filter({ hasText: 'Malformed CSV' })).toBeVisible();
  await expect(
    catalogPage.getByRole('alert').filter({ hasText: 'private-submitted-test-value' }),
  ).toHaveCount(0);
  const template = await context.request.get(`${origin}/catalog-template.v1.csv`);
  expect(template.status()).toBe(200);
  expect((await template.text()).trim()).toBe('id,sourceKey,name,series,categories,popularity');
  await expect(catalogPage.getByRole('link', { name: 'Download CSV headers' })).toBeVisible();
  await csvUpload.setInputFiles({
    name: 'workshop.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('\ufeff' + csvCatalog.replaceAll('\n', '\r\n')),
  });
  await catalogPage.getByRole('button', { name: 'Preview catalog and packs' }).click();
  await expect(catalogReview).toContainText('Original CSV catalog');
  await expect(catalogReview).toContainText('4 characters; 3 starter packs');
  await expect(catalogPage.getByLabel('Maximum category packs')).toHaveValue('10');
  await catalogPage.getByLabel('Category pack selection').selectOption('manual');
  await catalogPage
    .getByRole('checkbox', { name: 'wind walkers (2 characters)', exact: true })
    .check();
  await catalogPage.getByLabel('Pack name for wind walkers').fill('Wind Notes');
  await catalogPage.getByRole('button', { name: 'Preview catalog and packs' }).click();
  await expect(catalogReview).toContainText('4 characters; 2 starter packs');
  await realmWizardStep(catalogPage, 'Characters');
  await catalogPage.getByLabel('CSV revision', { exact: true }).fill('browser-revision-2');
  await expect(catalogReview).toHaveCount(0);
  await catalogPage.getByRole('button', { name: 'Preview catalog and packs' }).click();
  await expect(catalogReview).toContainText('Wind Notes');
  await expect(catalogPage.getByLabel('Pack name for wind walkers')).toHaveValue('Wind Notes');
  expect(
    await catalogPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await realmWizardStep(catalogPage, 'Review');
  await catalogPage.getByRole('button', { name: 'Create realm', exact: true }).click();
  await catalogPage.waitForURL(
    (url) => url.searchParams.has('realm') && url.searchParams.get('realm') !== customRealmId,
  );
  const csvRealmId = new URL(catalogPage.url()).searchParams.get('realm')!;
  const csvRows = (
    await db.query('SELECT id,provenance FROM characters WHERE realm_id=$1 ORDER BY id', [
      csvRealmId,
    ])
  ).rows;
  expect(csvRows.map((row) => row.id)).toEqual(customCatalog.characters.map((c) => c.id).sort());
  for (const row of csvRows)
    expect(row.provenance).toMatchObject({
      importKind: 'original-csv-v1',
      revision: 'browser-revision-2',
      rightsConfirmed: true,
    });
  await expect(catalogPage.locator('.pack')).toHaveCount(2);
  expect(
    (
      await db.query('SELECT name,category FROM packs WHERE realm_id=$1 ORDER BY name', [
        csvRealmId,
      ])
    ).rows,
  ).toEqual([
    { name: 'All Characters', category: null },
    { name: 'Wind Notes', category: 'wind walkers' },
  ]);
  await catalogPage.close();
  const plannedPreview = await context.request.post(`${origin}/api/realms/preview`, {
    headers: { Origin: origin },
    data: { config: defaultConfig, catalog: customChoice, packPlan: manualPlan },
  });
  expect(plannedPreview.status()).toBe(200);
  const plannedDigest = (await plannedPreview.json()).fingerprint;
  expect(
    (
      await context.request.post(`${origin}/api/realms`, {
        headers: { Origin: origin },
        data: {
          requestKey: crypto.randomUUID(),
          name: 'Changed plan',
          config: defaultConfig,
          catalog: customChoice,
          packPlan: { ...manualPlan, categories: [] },
          expectedPreview: plannedDigest,
        },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await context.request.post(`${origin}/api/realms`, {
        headers: { Origin: origin },
        data: {
          requestKey: crypto.randomUUID(),
          name: 'Unreviewed demo plan',
          config: defaultConfig,
          packPlan: { schemaVersion: 1, categories: [] },
        },
      })
    ).status(),
  ).toBe(409);
  const noPreview = await context.request.post(`${origin}/api/realms`, {
    headers: { Origin: origin },
    data: {
      requestKey: crypto.randomUUID(),
      name: 'Unreviewed',
      config: defaultConfig,
      catalog: customChoice,
    },
  });
  expect(noPreview.status()).toBe(409);
  expect(
    (
      await context.request.post(`${origin}/api/realms`, {
        headers: { Origin: origin },
        data: {
          requestKey: crypto.randomUUID(),
          name: 'Unreviewed CSV',
          config: defaultConfig,
          catalog: csvChoice,
        },
      })
    ).status(),
  ).toBe(409);
  const csvPreview = await context.request.post(`${origin}/api/realms/preview`, {
    headers: { Origin: origin },
    data: { config: defaultConfig, catalog: csvChoice },
  });
  expect(csvPreview.status()).toBe(200);
  const csvDigest = (await csvPreview.json()).fingerprint;
  expect(
    (
      await context.request.post(`${origin}/api/realms`, {
        headers: { Origin: origin },
        data: {
          requestKey: crypto.randomUUID(),
          name: 'Stale CSV',
          config: defaultConfig,
          catalog: { ...csvChoice, metadata: { ...csvMetadata, license: 'Changed license' } },
          expectedPreview: csvDigest,
        },
      })
    ).status(),
  ).toBe(409);
  const oversized = await context.request.post(`${origin}/api/realms/preview`, {
    headers: { Origin: origin },
    data: { padding: 'x'.repeat(providerCatalogRequestBytes) },
  });
  expect(oversized.status()).toBe(413);
  // Compressed uploads (as the browser sends large rosters) are parsed, and the
  // size cap applies after unpacking.
  const compressed = await context.request.post(`${origin}/api/realms/preview`, {
    headers: { Origin: origin, 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
    data: gzipSync(JSON.stringify({ name: 'Compressed preview' })),
  });
  // A partial preview request is completed with defaults: 200 means it was read.
  expect(compressed.status()).toBe(200);
  const expanding = await context.request.post(`${origin}/api/realms/preview`, {
    headers: { Origin: origin, 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
    data: gzipSync(JSON.stringify({ padding: 'x'.repeat(providerCatalogRequestBytes) })),
  });
  expect(expanding.status()).toBe(413);

  // Every play destination is a distinct route, with no unrelated screen mounted.
  await showScreen(page, 'packs');
  await expect(page.locator('.pack')).toHaveCount(6);
  await expect(page.locator('#collection,#market,#trades,#wishlist,#ranks')).toHaveCount(0);
  await page.screenshot({ path: '.test-data/routed-packs-desktop.png' });
  await openAccountMenu(page);
  await expect(page.getByRole('link', { name: 'Administration', exact: true })).toBeVisible();
  await page.getByRole('switch', { name: 'Admin view' }).uncheck();
  await expect(page.getByRole('link', { name: 'Administration', exact: true })).toHaveCount(0);
  await closeAccountMenu(page);
  await expect(
    page.getByText('Player preview: your own collection and balance', { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.test-data/routed-player-preview-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await openAccountMenu(page);
  await expect(page.getByRole('switch', { name: 'Admin view' })).not.toBeChecked();
  await page.getByRole('switch', { name: 'Admin view' }).check();
  await closeAccountMenu(page);
  const claimRequests: Record<string, unknown>[] = [];
  await page.route('**/api/gems/claim', async (route) => {
    claimRequests.push(route.request().postDataJSON());
    const result = await route.fetch();
    expect(result.status()).toBe(200);
    if (claimRequests.length === 1) await route.abort('failed');
    else await route.fulfill({ response: result });
  });
  const initialBalance = (await getRealmView(db, admin, realmId)).balance;
  await expect(page.getByRole('button', { name: 'Claim gems', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Your progression' })).toHaveCount(0);
  await page.locator('.header-recharge').click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/ranks');
  await page.getByRole('button', { name: 'Claim gems', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry gem claim', exact: true })).toBeVisible();
  // Locked navigation reports aria-disabled; a forced click must still not navigate.
  const lockedCollection = page.getByRole('link', { name: /^Collection/ });
  await expect(lockedCollection).toHaveAttribute('aria-disabled', 'true');
  await lockedCollection.click({ force: true });
  expect(new URL(page.url()).pathname).toBe('/ranks');
  await openAccountMenu(page);
  await expect(page.getByRole('switch', { name: 'Admin view' })).toBeDisabled();
  await closeAccountMenu(page);
  await page.getByRole('button', { name: 'Retry gem claim', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Claim on cooldown', exact: true })).toBeDisabled();
  expect(claimRequests).toHaveLength(2);
  expect(claimRequests[0]).toEqual(claimRequests[1]);
  expect((await getRealmView(db, admin, realmId)).balance).toBe(
    initialBalance + productConfig.gemRewards.amount,
  );
  const claimedReward = (await getRealmView(db, admin, realmId)).gemReward;
  await page.reload();
  await expect(page.getByRole('button', { name: 'Claim on cooldown', exact: true })).toBeDisabled();
  expect((await getRealmView(db, admin, realmId)).gemReward.nextClaimAt).toBe(
    claimedReward.nextClaimAt,
  );
  expect((await getRealmView(db, admin, realmId)).balance).toBe(
    initialBalance + productConfig.gemRewards.amount,
  );
  await page.unroute('**/api/gems/claim');
  await showScreen(page, 'packs');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.test-data/routed-packs-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const pack = await choosePack(page);
  const received = page.waitForResponse(
    (response) => response.url().endsWith('/api/open') && response.request().method() === 'POST',
  );
  await pack.locator('[id^="pack-open-"]').click();
  const receipt = await (await received).json();
  expect(receipt.ok).toBe(true);
  expect(receipt.charged).toBe(productConfig.packPrice);
  await showScreen(page, 'collection');
  await expect(page.locator('.character')).toHaveCount(1);
  await expect(page.locator('.pack')).toHaveCount(0);
  await page.screenshot({ path: '.test-data/routed-collection-desktop.png' });
  await page.goBack();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/packs');
  await expect(page.getByRole('heading', { name: 'Explore the packs', exact: true })).toBeVisible();
  await page.goBack();
  await expect(pack).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.has('pack')).toBe(true);
  await showScreen(page, 'collection');
  const reward = (await getRealmView(db, admin, realmId)).characterValues[receipt.characters[0].id]
    .recycleValue;
  const recycleRequests: unknown[] = [];
  await page.route('**/api/recycle', async (route) => {
    recycleRequests.push(route.request().postDataJSON());
    const result = await route.fetch();
    expect(result.status()).toBe(200);
    if (recycleRequests.length === 1) await route.abort('failed');
    else await route.fulfill({ response: result });
  });
  await page
    .getByRole('button', {
      name: `Recycle ${receipt.characters[0].name} for ${reward} gems`,
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Retry recycling', exact: true }).click();
  await expect(page.locator('.character')).toHaveCount(0);
  expect(recycleRequests[0]).toEqual(recycleRequests[1]);
  await page.unroute('**/api/recycle');
  await showScreen(page, 'wishlist');
  const wished = (await getRealmView(db, admin, realmId)).catalog.find(
    (character) => character.tier === 'common',
  )!;
  await page.getByRole('button', { name: 'Browse characters', exact: true }).click();
  const wishPicker = page.getByRole('dialog', { name: 'Choose a wishlist character', exact: true });
  await wishPicker.getByLabel('Search cards by name or series').fill(wished.name);
  await wishPicker.getByRole('button', { name: 'Select ' + wished.name, exact: true }).click();
  const wishRequests: unknown[] = [];
  await page.route('**/api/wishlist', async (route) => {
    wishRequests.push(route.request().postDataJSON());
    const result = await route.fetch();
    expect(result.status()).toBe(200);
    if (wishRequests.length === 1) await route.abort('failed');
    else await route.fulfill({ response: result });
  });
  await wishPicker.getByRole('button', { name: 'Choose character', exact: true }).click();
  const lockedPacks = page.getByRole('link', { name: 'Packs', exact: true });
  await expect(lockedPacks).toHaveAttribute('aria-disabled', 'true');
  await lockedPacks.click({ force: true });
  expect(new URL(page.url()).pathname).toBe('/wishlist');
  await page.getByRole('button', { name: 'Retry wishlist change', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Wishlist change saved.' }),
  ).toBeVisible();
  expect(wishRequests[0]).toEqual(wishRequests[1]);
  await page.unroute('**/api/wishlist');
  await expect(page.locator('.wishlist-character')).toHaveCount(1);
  await showScreen(page, 'ranks');
  await expect(page.getByRole('region', { name: 'Your progression' })).toContainText('7 XP');
  await expect(page.getByRole('region', { name: 'Pack upgrades' })).toHaveCount(0);
  await showScreen(page, 'packs');
  await choosePack(page);
  await expect(pack.locator('[id^="pack-open-"]')).toContainText(String(productConfig.packPrice));
  const apiReplay = await context.request.post(`${origin}/api/open`, {
    headers: { Origin: origin },
    data: receipt.requestKey ?? {},
  });
  expect(apiReplay.status()).toBe(400);
  const archived = parsePlayerArchive(
    await (await context.request.get(`${origin}/api/export?realmId=${realmId}`)).json(),
  );
  expect(archived.schemaVersion).toBe(12);
  const anonymous = await browser.newContext();
  for (const endpoint of [
    'open',
    'recycle',
    'upgrades/buy',
    'wishlist',
    'gems/claim',
    'catalog/provider',
  ])
    expect(
      (
        await anonymous.request.post(`${origin}/api/${endpoint}`, {
          headers: { Origin: origin },
          data: {},
        })
      ).status(),
    ).toBe(401);
  await anonymous.close();
  expect(
    (
      await context.request.post(`${origin}/api/gems/claim`, {
        headers: { Origin: 'https://untrusted.example' },
        data: {},
      })
    ).status(),
  ).toBe(403);
  const otherRealm = await createRealm(db, admin, 'Private second realm');
  const actualPlayer = await provisionPlayer(
      db,
      realmId,
      'ordinary-screen-player@example.test',
      password,
    ),
    playerContext = await browser.newContext();
  await playerContext.request.post(`${origin}/api/login`, {
    headers: { Origin: origin },
    data: { email: 'ordinary-screen-player@example.test', password },
  });
  const playerPage = await playerContext.newPage();
  await playerPage.goto(`${origin}/admin?realm=${realmId}`);
  await expect.poll(() => new URL(playerPage.url()).pathname).toBe('/packs');
  await expect(playerPage.getByRole('switch', { name: 'Admin view' })).toHaveCount(0);
  await expect(playerPage.getByRole('link', { name: 'Administration', exact: true })).toHaveCount(
    0,
  );
  expect(
    (
      await playerContext.request.post(`${origin}/api/settings/preview`, {
        headers: { Origin: origin },
        data: { realmId, config: defaultConfig },
      })
    ).status(),
  ).toBe(403);
  expect(
    (await playerContext.request.get(`${origin}/api/export?realmId=${otherRealm}`)).status(),
  ).toBe(403);
  expect(
    (
      await playerContext.request.post(`${origin}/api/catalog/provider`, {
        headers: { Origin: origin },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await playerContext.request.post(`${origin}/api/gems/claim`, {
        headers: { Origin: origin },
        data: { realmId: otherRealm, requestKey: crypto.randomUUID() },
      })
    ).status(),
  ).toBe(403);
  expect((await getRealmView(db, actualPlayer, realmId)).balance).toBe(productConfig.startingGems);
  await playerPage.locator('.header-recharge').click();
  await expect.poll(() => new URL(playerPage.url()).pathname).toBe('/ranks');
  await playerPage.getByRole('button', { name: 'Claim gems', exact: true }).click();
  await expect(
    playerPage.getByRole('button', { name: 'Claim on cooldown', exact: true }),
  ).toBeDisabled();
  expect((await getRealmView(db, actualPlayer, realmId)).balance).toBe(
    productConfig.startingGems + productConfig.gemRewards.amount,
  );
  expect((await getRealmView(db, actualPlayer, realmId)).cards).toHaveLength(0);
  await playerContext.close();
  await showScreen(page, 'admin');
  await page.screenshot({ path: '.test-data/routed-admin-desktop.png' });
  await expect(page.getByRole('heading', { name: 'Setup checklist' })).toBeVisible();
  await adminSection(page, 'Game rules').click();
  const settings = page.getByRole('region', { name: 'Game rules', exact: true });
  const tradeExpiry = settings.getByLabel('Trade expiry', { exact: true });
  await expect(tradeExpiry).not.toBeVisible();
  await settings.getByRole('tab', { name: 'Trading', exact: true }).click();
  await expect(tradeExpiry).toBeVisible();
  await tradeExpiry.fill('0');
  await settings.getByRole('tab', { name: 'Economy', exact: true }).click();
  await expect(tradeExpiry).not.toBeVisible();
  await settings.getByRole('button', { name: 'Preview settings changes', exact: true }).click();
  await expect(settings.getByRole('tab', { name: 'Trading', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(tradeExpiry).toBeFocused();
  await tradeExpiry.fill(String(defaultConfig.trading.expiresAfterMinutes));
  await settings.getByRole('tab', { name: 'Economy', exact: true }).click();
  await settings.getByLabel('Pack price', { exact: true }).fill('12');
  // "Use recommended" appears only while the claim rules differ, and restores them.
  const recommendedClaims = settings.getByRole('button', { name: /^Use recommended: / });
  const claimAmount = settings.getByLabel('Gems per claim', { exact: true });
  await expect(recommendedClaims).toHaveCount(0);
  await claimAmount.fill('5');
  await expect(recommendedClaims).toHaveText(/^Use recommended: 1.?000 gems every 6 h$/);
  await recommendedClaims.click();
  await expect(claimAmount).toHaveValue(String(productConfig.gemRewards.amount));
  await expect(recommendedClaims).toHaveCount(0);
  await settings.getByRole('button', { name: 'Preview settings changes', exact: true }).click();
  const impact = page.getByRole('region', { name: 'Settings impact preview', exact: true });
  await expect(
    impact.getByRole('button', { name: 'Apply reviewed settings', exact: true }),
  ).toBeEnabled();
  await impact.getByRole('button', { name: 'Apply reviewed settings', exact: true }).click();
  await expect(settings).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Game rules saved. Revision 2 is active.' })).toBeVisible();
  expect((await getRealmView(db, admin, realmId)).configRevision).toBe(2);
  await adminSection(page, 'Players & access').click();
  await page.getByLabel('Discord user ID', { exact: true }).fill(discordPlayer);
  await page.getByRole('button', { name: 'Invite player', exact: true }).click();
  await expect(
    page.getByText('Invitation saved. This player can now continue with Discord.', { exact: true }),
  ).toBeVisible();
  // Complete a provider-verified sign-in with a local fixture, preserving account state.
  await openAccountMenu(page);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  const discordSubject = discordAdmin;
  await context.route('https://discord.com/oauth2/authorize?**', async (route) => {
    const authorization = new URL(route.request().url()),
      callback = new URL('/api/auth/discord/callback', origin);
    callback.search = new URLSearchParams({
      state: authorization.searchParams.get('state')!,
      iss: 'https://discord.com',
      code: Buffer.from(
        JSON.stringify({
          subject: discordSubject,
          challenge: authorization.searchParams.get('code_challenge'),
        }),
      ).toString('base64url'),
    }).toString();
    await route.fulfill({
      contentType: 'text/html',
      body: `<html><body><a href="${callback.href.replaceAll('&', '&amp;')}">Authorize fixture account</a></body></html>`,
    });
  });
  await page.getByRole('button', { name: 'Continue with Discord', exact: true }).click();
  await page.getByRole('link', { name: 'Authorize fixture account', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  // Two authenticated players trade through the UI, including an unknown outcome retry.
  const tradeRealm = await createRealm(db, admin, 'Browser trading realm');
  const partner = await provisionPlayer(db, tradeRealm, 'browser-player@example.test', password);
  const tradePack = (await getRealmView(db, admin, tradeRealm)).packs.find(
    (p) => p.name === 'All Characters',
  )!.id;
  await openPack(db, admin, tradeRealm, tradePack, crypto.randomUUID());
  await openPack(db, partner, tradeRealm, tradePack, crypto.randomUUID());
  const tradeBeforeA = await getRealmView(db, admin, tradeRealm),
    tradeBeforeB = await getRealmView(db, partner, tradeRealm);
  const partnerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await partnerContext.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  await partnerContext.request.post(`${origin}/api/login`, {
    headers: { Origin: origin },
    data: { email: 'browser-player@example.test', password },
  });
  const partnerPage = await partnerContext.newPage();
  partnerPage.on('pageerror', (error) => pageErrors.push(error));
  const traderSubject = '400000000000000001';
  await linkDiscordAccount(db, 'browser-player@example.test', traderSubject);
  await partnerContext.route('https://discord.com/oauth2/authorize?**', async (route) => {
    const authorization = new URL(route.request().url()),
      callback = new URL('/api/auth/discord/callback', origin);
    callback.search = new URLSearchParams({
      state: authorization.searchParams.get('state')!,
      iss: 'https://discord.com',
      code: Buffer.from(
        JSON.stringify({
          subject: traderSubject,
          challenge: authorization.searchParams.get('code_challenge'),
        }),
      ).toString('base64url'),
    }).toString();
    await route.fulfill({
      contentType: 'text/html',
      body: `<html><body><a href="${callback.href.replaceAll('&', '&amp;')}">Authorize fixture trader</a></body></html>`,
    });
  });
  const traderFlow = await partnerContext.request.post(`${origin}/api/auth/discord/start`, {
    headers: { Origin: origin },
    data: {},
  });
  await partnerPage.goto((await traderFlow.json()).url);
  await partnerPage.getByRole('link', { name: 'Authorize fixture trader' }).click();
  await partnerPage.goto(`${origin}/trades?realm=${tradeRealm}`);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/trades?realm=${tradeRealm}`);
  const trades = page.getByRole('region', { name: 'Your trades' }),
    partnerTrades = partnerPage.getByRole('region', { name: 'Your trades' });
  await expect(partnerTrades.getByLabel('Your trade ID in this realm')).toHaveValue(
    tradeBeforeB.tradeCode,
  );
  const tradeRequests: Record<string, unknown>[] = [];
  await page.route('**/api/trades', async (route) => {
    tradeRequests.push(route.request().postDataJSON());
    const response = await route.fetch();
    if (tradeRequests.length === 1) {
      expect(response.status()).toBe(200);
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  await trades.getByText('Start a trade', { exact: true }).click();
  await trades.getByLabel('Search realm members').fill('no-such-member');
  await expect(
    trades.getByText('No members found. Try another name or paste a trade ID below.', {
      exact: true,
    }),
  ).toBeVisible();
  let failSearch = true;
  await page.route('**/api/members?**', async (route) => {
    if (failSearch && new URL(route.request().url()).searchParams.get('query') === 'atlas_player') {
      failSearch = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Fixture member search unavailable.' }),
      });
    } else await route.continue();
  });
  await trades.getByLabel('Search realm members').fill('atlas_player');
  await trades.getByRole('button', { name: 'Retry member search' }).click();
  const namedPartner = trades.getByRole('radio', {
    name: new RegExp(`Choose Atlas Player \\(${tradeBeforeB.tradeCode}\\)`),
  });
  await namedPartner.focus();
  await page.keyboard.press('Space');
  await expect(namedPartner).toBeChecked();
  await expect(trades.getByLabel('Other player’s trade ID')).toHaveValue(tradeBeforeB.tradeCode);
  await expect(trades.getByText('Trade partner:', { exact: false })).toContainText('Atlas Player');
  await trades.screenshot({ path: '.test-data/member-picker-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await trades.screenshot({ path: '.test-data/member-picker-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const privateMembers = await context.request.get(`${origin}/api/members?realmId=${tradeRealm}`);
  expect(privateMembers.headers()['cache-control']).toContain('no-store');
  const membersPage = await privateMembers.json();
  expect(Object.keys(membersPage.members[0]).sort()).toEqual([
    'displayName',
    'tradeCode',
    'username',
  ]);
  expect(
    (await partnerContext.request.get(`${origin}/api/members?realmId=${otherRealm}`)).status(),
  ).toBe(403);
  const noMemberSession = await browser.newContext();
  expect(
    (await noMemberSession.request.get(`${origin}/api/members?realmId=${tradeRealm}`)).status(),
  ).toBe(401);
  await noMemberSession.close();
  await page.unroute('**/api/members?**');
  await trades.getByLabel('Gems you offer', { exact: true }).fill('5');
  await trades.getByRole('button', { name: 'Browse your collection', exact: true }).click();
  const offeredCards = page.getByRole('dialog', { name: 'Choose cards to trade', exact: true });
  await offeredCards
    .getByRole('button', { name: `Select ${tradeBeforeA.cards[0].name}`, exact: true })
    .click();
  await offeredCards.getByRole('button', { name: 'Use 1 selected cards', exact: true }).click();
  await trades.getByRole('button', { name: 'Send trade offer' }).click();
  await trades.getByRole('button', { name: 'Retry trade request' }).click();
  await expect(trades.getByRole('heading', { name: 'Trade · pending', exact: true })).toBeVisible();
  expect(tradeRequests[1]).toEqual(tradeRequests[0]);
  const tradeId = (await getRealmView(db, admin, tradeRealm)).trades[0].id;
  expect((await getRealmView(db, admin, tradeRealm)).cards[0].lockedForTrade).toBe(true);
  await partnerTrades.getByRole('button', { name: 'Refresh trades' }).click();
  const theirs = partnerTrades.getByRole('article', { name: `Trade ${tradeId}` }),
    ours = trades.getByRole('article', { name: `Trade ${tradeId}` });
  await expect(ours).toContainText('Atlas Player');
  await expect(theirs).toContainText('Atlas Admin');
  await theirs.getByRole('button', { name: 'Edit my offer' }).click();
  await theirs.getByLabel('Gems you offer', { exact: true }).fill('2');
  await theirs.getByRole('button', { name: 'Browse your collection', exact: true }).click();
  const partnerOfferedCards = partnerPage.getByRole('dialog', {
    name: 'Choose cards to trade',
    exact: true,
  });
  await partnerOfferedCards
    .getByRole('button', { name: `Select ${tradeBeforeB.cards[0].name}`, exact: true })
    .click();
  await partnerOfferedCards
    .getByRole('button', { name: 'Use 1 selected cards', exact: true })
    .click();
  await theirs.getByRole('button', { name: 'Save my offer' }).click();
  await expect(theirs).toContainText('Offer version 2');
  await trades.getByRole('button', { name: 'Refresh trades' }).click();
  await expect(ours).toContainText('Offer version 2');
  await ours.getByRole('button', { name: 'Confirm this offer' }).click();
  await expect(ours.getByRole('button', { name: 'Your confirmation saved' })).toBeDisabled();
  await theirs.getByRole('button', { name: 'Edit my offer' }).click();
  await theirs.getByLabel('Gems you offer', { exact: true }).fill('3');
  await theirs.getByRole('button', { name: 'Save my offer' }).click();
  await expect(theirs).toContainText('Offer version 3');
  await trades.getByRole('button', { name: 'Refresh trades' }).click();
  await expect(ours).toContainText('Offer version 3');
  await expect(ours.getByRole('button', { name: 'Confirm this offer' })).toBeEnabled();
  await ours.getByRole('button', { name: 'Confirm this offer' }).click();
  await expect(ours.getByRole('button', { name: 'Your confirmation saved' })).toBeDisabled();
  await theirs.getByRole('button', { name: 'Confirm this offer' }).click();
  await expect(theirs.getByRole('heading', { name: 'Trade · completed' })).toBeVisible();
  await trades.getByRole('button', { name: 'Refresh trades' }).click();
  await expect(ours.getByRole('heading', { name: 'Trade · completed' })).toBeVisible();
  const tradeAfterA = await getRealmView(db, admin, tradeRealm),
    tradeAfterB = await getRealmView(db, partner, tradeRealm);
  expect(tradeAfterA.cards[0].cardId).toBe(tradeBeforeB.cards[0].cardId);
  expect(tradeAfterB.cards[0].cardId).toBe(tradeBeforeA.cards[0].cardId);
  expect([tradeAfterA.balance, tradeAfterB.balance]).toEqual([88, 92]);
  expect([tradeAfterA.progression.totalXp, tradeAfterB.progression.totalXp]).toEqual([10, 10]);
  const tradeArchive = parsePlayerArchive(
    await (await context.request.get(`${origin}/api/export?realmId=${tradeRealm}`)).json(),
  );
  expect(tradeArchive).toMatchObject({
    schemaVersion: 12,
    trades: [{ id: tradeId, status: 'completed' }],
  });
  expect(
    (
      await context.request.post(`${origin}/api/trades`, {
        headers: { Origin: 'https://untrusted.example' },
        data: tradeRequests[0],
      })
    ).status(),
  ).toBe(403);
  const tradeAnonymous = await browser.newContext();
  expect(
    (
      await tradeAnonymous.request.post(`${origin}/api/trades`, {
        headers: { Origin: origin },
        data: tradeRequests[0],
      })
    ).status(),
  ).toBe(401);
  await tradeAnonymous.close();
  expect(
    await partnerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await trades.screenshot({ path: '.test-data/trades-desktop.png' });
  await partnerTrades.screenshot({ path: '.test-data/trades-mobile.png' });
  await partnerContext.close();
  // Exercise the real production HTTP signature boundary and shared web state.
  const discordRealm = await createRealm(db, admin, 'Browser Discord commands');
  await page.goto(`${origin}/admin?realm=${discordRealm}&task=access`);
  const discordSetup = page.getByRole('region', { name: 'Discord gameplay setup' }),
    guildId = '800000000000000001';
  await discordSetup.getByLabel('Discord server ID', { exact: true }).fill(guildId);
  await discordSetup.getByRole('button', { name: 'Link Discord server', exact: true }).click();
  await expect(discordSetup).toContainText(`Linked server: ${guildId}`);
  let discordInteractionId = 700000000000000000n;
  const discordPayload = (type: number, data?: unknown) => ({
    id: String(++discordInteractionId),
    application_id: '900000000000000001',
    type,
    guild_id: guildId,
    member: { user: { id: discordAdmin } },
    ...(data ? { data } : {}),
  });
  async function signedInteraction(payload: unknown, invalid = false) {
    const raw = JSON.stringify(payload),
      timestamp = String(Math.floor(Date.now() / 1000));
    return context.request.post(`${origin}/api/discord/interactions`, {
      headers: {
        'Content-Type': 'application/json',
        'x-signature-timestamp': timestamp,
        'x-signature-ed25519': invalid
          ? '0'.repeat(128)
          : sign(null, Buffer.from(timestamp + raw), signingKeys.privateKey).toString('hex'),
      },
      data: raw,
    });
  }
  const ping = discordPayload(1);
  expect((await signedInteraction(ping, true)).status()).toBe(401);
  expect(await (await signedInteraction(ping)).json()).toEqual({ type: 1 });
  const reviewResponse = await signedInteraction(
    discordPayload(2, {
      name: 'bakufu',
      type: 1,
      options: [
        { name: 'open', type: 1, options: [{ name: 'pack', type: 3, value: 'All Characters' }] },
      ],
    }),
  );
  expect(reviewResponse.status()).toBe(200);
  const review = await reviewResponse.json();
  expect(review.data.flags).toBe(64);
  expect((await getRealmView(db, admin, discordRealm)).balance).toBe(100);
  const customId = review.data.components[0].components[0].custom_id;
  const confirmation = discordPayload(3, { component_type: 2, custom_id: customId });
  const opened = await (await signedInteraction(confirmation)).json();
  expect(opened.data.content).toContain('Spent 10 gems');
  expect(await (await signedInteraction(confirmation)).json()).toEqual(opened);
  await page.reload();
  await expect(page.locator('.header-gems strong')).toContainText('90');
  expect((await getRealmView(db, admin, discordRealm)).cards).toHaveLength(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await discordSetup.screenshot({ path: '.test-data/discord-setup-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await discordSetup.screenshot({ path: '.test-data/discord-setup-desktop.png' });
  await discordSetup.getByRole('button', { name: 'Unlink Discord server', exact: true }).click();
  await expect(discordSetup).toContainText('No Discord server linked.');
  expect(
    (
      await (
        await signedInteraction(
          discordPayload(2, { name: 'bakufu', type: 1, options: [{ name: 'status', type: 1 }] }),
        )
      ).json()
    ).data.content,
  ).toContain('not linked');
  const unauthorizedBinding = await context.request.post(`${origin}/api/discord/guild`, {
    headers: { Origin: 'https://untrusted.example' },
    data: { realmId: discordRealm, guildId },
  });
  expect(unauthorizedBinding.status()).toBe(403);
  // Public join links require fresh, realm-bound membership verification.
  const admissionRealm = await createRealm(db, admin, 'Browser community joining'),
    admissionGuild = '800000000000000002';
  await page.goto(`${origin}/admin?realm=${admissionRealm}&task=access`);
  await discordSetup.getByLabel('Discord server ID', { exact: true }).fill(admissionGuild);
  await discordSetup.getByRole('button', { name: 'Link Discord server', exact: true }).click();
  await expect(discordSetup).toContainText(`Linked server: ${admissionGuild}`);
  const joining = page.getByRole('region', { name: 'Realm joining' }),
    admissionRequests: unknown[] = [];
  await page.route('**/api/admission', async (route) => {
    admissionRequests.push(route.request().postDataJSON());
    const response = await route.fetch();
    if (admissionRequests.length === 1) {
      expect(response.status()).toBe(200);
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  await joining.getByLabel('Joining mode').selectOption('discord_server');
  await joining.getByRole('button', { name: 'Save joining settings', exact: true }).click();
  await joining.getByRole('button', { name: 'Retry joining settings save' }).click();
  await expect(joining.getByLabel('Join link', { exact: true })).toBeVisible();
  expect(admissionRequests[1]).toEqual(admissionRequests[0]);
  const joinPath = await joining.getByLabel('Join link', { exact: true }).inputValue();
  await discordSetup.getByRole('button', { name: 'Unlink Discord server', exact: true }).click();
  await expect(discordSetup.getByRole('alert')).toContainText('Disable server joining');
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let guestSubject = '500000000000000001',
    guestGuild: string | undefined = admissionGuild;
  await guestContext.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  await guestContext.route('https://discord.com/oauth2/authorize?**', async (route) => {
    const auth = new URL(route.request().url()),
      callback = new URL(auth.searchParams.get('redirect_uri')!);
    expect(auth.searchParams.get('scope')).toBe('identify guilds.members.read');
    callback.searchParams.set('state', auth.searchParams.get('state')!);
    callback.searchParams.set('iss', 'https://discord.com');
    callback.searchParams.set(
      'code',
      Buffer.from(
        JSON.stringify({
          subject: guestSubject,
          challenge: auth.searchParams.get('code_challenge'),
          scope: auth.searchParams.get('scope'),
          guildId: guestGuild,
        }),
      ).toString('base64url'),
    );
    await route.fulfill({
      contentType: 'text/html',
      body: `<a href="${callback.href.replaceAll('&', '&amp;')}">Authorize joining fixture</a>`,
    });
  });
  const guest = await guestContext.newPage();
  guest.on('pageerror', (error) => pageErrors.push(error));
  expect(
    (
      await guestContext.request.post(`${origin}/api/admission`, {
        headers: { Origin: origin },
        data: admissionRequests[0],
      })
    ).status(),
  ).toBe(401);
  await guest.goto(`${origin}${joinPath}`);
  await expect(
    guest.getByRole('heading', { name: 'Join Browser community joining' }),
  ).toBeVisible();
  expect(
    await guest.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await guest.screenshot({ path: '.test-data/join-mobile.png' });
  await guest.getByRole('button', { name: 'Verify with Discord and join' }).click();
  await guest.getByRole('link', { name: 'Authorize joining fixture' }).click();
  await guest.waitForURL(
    (url) =>
      ['/', '/packs'].includes(url.pathname) && url.searchParams.get('realm') === admissionRealm,
  );
  await expect(guest.locator('.header-gems strong')).toContainText('100');
  await expect(guest.getByRole('region', { name: 'Realm joining' })).toHaveCount(0);
  expect(
    (
      await guestContext.request.post(`${origin}/api/admission`, {
        headers: { Origin: origin },
        data: admissionRequests[0],
      })
    ).status(),
  ).toBe(403);
  const joinedArchive = parsePlayerArchive(
    await (await guestContext.request.get(`${origin}/api/export?realmId=${admissionRealm}`)).json(),
  );
  expect(joinedArchive).toMatchObject({
    schemaVersion: 12,
    realmAdmission: { method: 'discord_server', guildId: admissionGuild, startingGems: 100 },
  });
  const guestAccount = (
    await db.query(
      "SELECT account_id FROM account_identities WHERE provider='discord' AND subject=$1",
      [guestSubject],
    )
  ).rows[0].account_id;
  const joinedView = await getRealmView(db, guestAccount, admissionRealm);
  await openPack(db, guestAccount, admissionRealm, joinedView.packs[0].id, crypto.randomUUID());
  await guest.goto(`${origin}${joinPath}`);
  await guest.getByRole('button', { name: 'Verify with Discord and join' }).click();
  await guest.getByRole('link', { name: 'Authorize joining fixture' }).click();
  await guest.waitForURL(
    (url) =>
      ['/', '/packs'].includes(url.pathname) && url.searchParams.get('realm') === admissionRealm,
  );
  await expect(guest.locator('.header-gems strong')).toContainText('90');
  await showScreen(guest, 'collection');
  await expect(guest.locator('.character')).toHaveCount(1);
  guestSubject = '600000000000000001';
  guestGuild = undefined;
  await guest.goto(`${origin}${joinPath}`);
  await guest.getByRole('button', { name: 'Verify with Discord and join' }).click();
  await guest.getByRole('link', { name: 'Authorize joining fixture' }).click();
  await expect(guest.getByRole('alert')).toContainText('server membership');
  expect(
    (
      await db.query("SELECT 1 FROM account_identities WHERE provider='discord' AND subject=$1", [
        guestSubject,
      ])
    ).rowCount,
  ).toBe(0);
  await page.unroute('**/api/admission');
  await joining.getByLabel('Joining mode').selectOption('invite_only');
  await joining.getByRole('button', { name: 'Save joining settings', exact: true }).click();
  await expect(joining.getByLabel('Join link', { exact: true })).toHaveCount(0);
  await guest.goto(`${origin}${joinPath}`);
  await expect(guest.getByRole('heading', { name: 'Join link unavailable' })).toBeVisible();
  await guest.goto(`${origin}/admin?realm=${admissionRealm}`);
  await expect(guest.locator('.header-gems strong')).toContainText('90');
  await openAccountMenu(guest);
  await guest.getByRole('link', { name: 'Account settings', exact: true }).click();
  await expect(guest.getByRole('region', { name: 'Account settings' })).toContainText(
    'This account has no local password',
  );
  await guestContext.close();
  await verifyPasswordChanges(browser, db, origin, realmId);
  await verifyPlayerRework(browser, db, origin);
  await verifyProviderPipeline(browser, db, origin, 'browser-admin@example.test', password);
  await verifyBatchPlay(browser, db, origin, admin, 'browser-admin@example.test', password);
  await verifyRevealLoading(browser, db, origin, admin, 'browser-admin@example.test', password);
  await verifyJikanBrowser(browser, db, origin, 'browser-admin@example.test', password);
  await verifyRevealSoundsAdmin(browser, db, origin, 'browser-admin@example.test', password);
  await verifyAdminCollections(browser, db, origin, admin, 'browser-admin@example.test', password);
  await verifyCollectionExperience(
    browser,
    db,
    origin,
    admin,
    'browser-admin@example.test',
    password,
  );
  expect(pageErrors).toEqual([]);
  await context.close();
  console.log(
    'Browser checks passed: physical cards/inspection, consecutive cooldown-free 1/5/10 openings, popularity/demand values, 1000-character glossary, visual trade/wishlist pickers, single-click collector ranks/recycling and replay, five-tier motion/sound, Discord avatars/fallback, route scroll recovery, atomic pack loading/reveals, XP/gem timers, market/trading/retry receipts, player archive v12, account/Discord/provider/catalog flows, RBAC/CSRF and desktop/mobile accessibility.',
  );
} finally {
  await browser?.close();
  server.kill();
  await Promise.race([
    new Promise<void>((resolve) => {
      if (server.exitCode !== null) resolve();
      else server.once('exit', () => resolve());
    }),
    delay(5000),
  ]);
  await db.end();
  await postgres.stop();
}
