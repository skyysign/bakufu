import { createDiscordDatabase, discordInteractionSettings, type Database } from '@card-engine/db';
import { handleDiscordRequest } from '../../../../lib/discord-interactions';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const globalPool = globalThis as typeof globalThis & { cardEngineDiscordDb?: Database };
export async function POST(request: Request) {
  try {
    return await handleDiscordRequest(request, discordInteractionSettings(process.env), () => {
      if (!process.env.DATABASE_URL) throw new Error('Database unavailable.');
      return (globalPool.cardEngineDiscordDb ??= createDiscordDatabase(process.env.DATABASE_URL));
    });
  } catch {
    return Response.json(
      { error: 'Discord interactions are not configured correctly.' },
      { status: 503 },
    );
  }
}
