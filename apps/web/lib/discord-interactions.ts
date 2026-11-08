import { GameError } from '../../../packages/core/src/index';
import { discordGameplay } from '../../../packages/db/src/discord-interactions';
import {
  discordMessage,
  parseDiscordInteraction,
  verifyDiscordSignature,
  type DiscordInteractionSettings,
} from '../../../packages/db/src/discord-protocol';
import type { Database } from '../../../packages/db/src/connection';

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
async function rawBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new GameError('BAD_REQUEST', 'A request body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, 250);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) {
        await reader.cancel();
        throw new GameError('TOO_LARGE', 'Request is too large.', 413);
      }
      chunks.push(value);
    }
    if (timedOut) throw new GameError('BAD_REQUEST', 'Request body timed out.', 408);
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(deadline);
    reader.releaseLock();
  }
}
export async function handleDiscordRequest(
  request: Request,
  settings: DiscordInteractionSettings | null,
  database: () => Database,
): Promise<Response> {
  if (!settings) return json({ error: 'Discord interactions are disabled.' }, 503);
  let action;
  let verified = false;
  try {
    const body = await rawBody(request);
    if (
      !verifyDiscordSignature(
        body,
        request.headers.get('x-signature-ed25519'),
        request.headers.get('x-signature-timestamp'),
        settings.publicKey,
      )
    )
      return json({ error: 'Invalid request signature.' }, 401);
    verified = true;
    action = parseDiscordInteraction(JSON.parse(body.toString('utf8')), settings.applicationId);
  } catch (error) {
    if (error instanceof GameError)
      return !verified || error.status === 401
        ? json({ error: error.message }, error.status)
        : json(discordMessage(error.message), error.status === 413 ? 413 : 200);
    return json({ error: 'Invalid Discord interaction.' }, 400);
  }
  if (action.kind === 'ping') return json({ type: 1 });
  try {
    return json(await discordGameplay(database(), settings.applicationId, action));
  } catch (error) {
    return json(
      discordMessage(
        error instanceof GameError
          ? error.message
          : 'The server is busy or the result is unconfirmed. Retry the same confirmation button; check your website collection before starting another opening.',
      ),
    );
  }
}
