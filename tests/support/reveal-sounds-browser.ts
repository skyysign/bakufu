import { expect, type Browser } from '@playwright/test';
import type { Database } from '../../packages/db/src/index';

// A 16-bit PCM WAV of an original synthesized tone (no third-party audio).
function toneWav(seconds: number, rate: number, channels: number) {
  const frames = Math.round(seconds * rate),
    bytes = Buffer.alloc(44 + frames * channels * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + frames * channels * 2, 4);
  bytes.write('WAVE', 8);
  bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * channels * 2, 28);
  bytes.writeUInt16LE(channels * 2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(frames * channels * 2, 40);
  for (let i = 0; i < frames; i++)
    for (let channel = 0; channel < channels; channel++)
      bytes.writeInt16LE(Math.round(Math.sin(i / 18) * 6000), 44 + (i * channels + channel) * 2);
  return bytes;
}

/**
 * Administration → Reveal sounds in a real browser: the permission gate, a
 * rarity sound longer than 30 seconds cut to 30 seconds, and a character sound
 * that takes priority (stored per character) and can be removed again.
 */
export async function verifyRevealSoundsAdmin(
  browser: Browser,
  db: Database,
  origin: string,
  email: string,
  password: string,
) {
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
    const realm = (
      await db.query(
        `SELECT r.id FROM realms r JOIN memberships m ON m.realm_id=r.id JOIN accounts a ON a.id=m.account_id
        WHERE a.email=$1 AND m.role='admin' ORDER BY r.created_at DESC LIMIT 1`,
        [email],
      )
    ).rows[0].id as string;
    const character = (
      await db.query('SELECT id,name FROM characters WHERE realm_id=$1 ORDER BY name LIMIT 1', [realm])
    ).rows[0] as { id: string; name: string };
    const page = await context.newPage();
    await page.goto(`${origin}/admin?task=sounds&realm=${realm}`);
    const section = page.getByRole('region', { name: 'Reveal sounds', exact: true });
    const legendary = section.getByLabel('Upload Legendary sound', { exact: true });
    await expect(legendary).toBeDisabled();
    await section
      .getByRole('checkbox', { name: 'I made these sounds or have permission to use them in this realm.' })
      .check();
    await legendary.setInputFiles({
      name: 'original-long-tone.wav',
      mimeType: 'audio/wav',
      buffer: toneWav(35, 22050, 2),
    });
    await expect(section.getByRole('status')).toContainText(
      'Legendary sound saved. It was 35 s long, so the first 30 s are used.',
      { timeout: 30000 },
    );
    const row = section.locator('.sound-row[data-tier="legendary"]');
    await expect(row).toContainText('original-long-tone.wav');
    await expect(row).toContainText('30 s');
    await expect(row.getByRole('button', { name: 'Play Legendary sound' })).toBeVisible();
    const stored = await db.query(
      'SELECT duration_ms FROM realm_tier_sounds WHERE realm_id=$1 AND tier=$2',
      [realm, 'legendary'],
    );
    expect(stored.rows).toEqual([{ duration_ms: 30000 }]);

    // A character's own sound.
    await section.getByLabel('Find a character', { exact: true }).fill(character.name);
    await section.getByRole('button', { name: 'Find character', exact: true }).click();
    const found = section.getByRole('list', { name: 'Characters found' });
    await expect(found).toContainText(character.name);
    await found
      .getByLabel(`Upload ${character.name} sound`, { exact: true })
      .first()
      .setInputFiles({ name: 'original-short-tone.wav', mimeType: 'audio/wav', buffer: toneWav(1.5, 22050, 1) });
    const characterRows = section.getByRole('list', { name: 'Character sounds' });
    await expect(characterRows).toContainText(character.name, { timeout: 30000 });
    await expect(characterRows).toContainText('original-short-tone.wav');
    expect(
      (
        await db.query(
          'SELECT duration_ms FROM realm_character_sounds WHERE realm_id=$1 AND character_id=$2',
          [realm, character.id],
        )
      ).rows,
    ).toEqual([{ duration_ms: 1500 }]);
    await characterRows.getByRole('button', { name: `Remove ${character.name} sound` }).click();
    await expect(section.getByRole('status')).toContainText(`${character.name} uses the rarity sound again.`);
    await expect(characterRows).toHaveCount(0);
    await row.getByRole('button', { name: 'Remove Legendary sound' }).click();
    await expect(row).toContainText('Built-in sound');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  } finally {
    await context.close();
  }
}
