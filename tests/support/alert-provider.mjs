// Test-only transport. Never contacts an external receiver.
import { appendFile } from 'node:fs/promises';
globalThis.fetch = async (url, options) => {
  if (String(url) !== 'https://alerts.fixture.test/hook' || options.redirect !== 'error')
    throw new Error('Only the isolated alert fixture is allowed.');
  const event = JSON.parse(options.body);
  if (options.headers['Idempotency-Key'] !== event.id) throw new Error('Missing stable ID.');
  await appendFile('/fixture-alerts/events.jsonl', JSON.stringify(event) + '\n');
  return new globalThis.Response(null, { status: 202 });
};
