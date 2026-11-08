import { createHash } from 'node:crypto';
import { z } from 'zod';
import { GameError } from '../../core/src/index';
import {
  fetchWikidataCatalog,
  wikidataCatalogRequestSchema,
  WikidataCatalogError,
  fetchSelectedProviderCatalog,
  providerCatalogRequestSchema,
  ProviderCatalogError,
  jikanApiRequestSchema,
  fetchJikanApiStep,
  aniListApiRequestSchema,
  fetchAniListApiStep,
  jikanPacing,
} from '../../importers/src/index';
import { requireInstanceAdmin } from './auth';
import { transaction, type Database } from './connection';
const requestSchema = wikidataCatalogRequestSchema.extend({ providerConsent: z.literal(true) });
// Operator-initiated, bounded metadata lookup; no pagination or background crawl.
export async function fetchAnimeCatalog(
  db: Database,
  actorId: string,
  input: unknown,
  fetcher: typeof fetch = fetch,
) {
  const request = await transaction(db, async (tx) => {
    await requireInstanceAdmin(tx, actorId);
    const selected = requestSchema.parse(input);
    const key = createHash('sha256').update(`wikidata-metadata:${actorId}`).digest('hex');
    const row = (
      await tx.query(
        `INSERT INTO login_limits(email_key,attempts,window_start) VALUES($1,1,now())
      ON CONFLICT(email_key) DO UPDATE SET attempts=CASE WHEN login_limits.window_start<now()-interval '1 minute' THEN 1 ELSE login_limits.attempts+1 END,
      window_start=CASE WHEN login_limits.window_start<now()-interval '1 minute' THEN now() ELSE login_limits.window_start END RETURNING attempts`,
        [key],
      )
    ).rows[0];
    return { selected, allowed: row.attempts <= 6 };
  });
  if (!request.allowed)
    throw new GameError(
      'RATE_LIMITED',
      'Too many metadata lookups. Wait one minute before trying again.',
      429,
    );
  const { providerConsent, ...selection } = request.selected;
  void providerConsent;
  try {
    return await fetchWikidataCatalog(selection, fetcher);
  } catch (error) {
    if (error instanceof WikidataCatalogError)
      throw new GameError(error.code, error.message, error.status);
    throw error;
  }
}

// Provider-specific transport/normalization ends at the canonical catalog boundary.
export async function fetchProviderCatalog(
  db: Database,
  actorId: string,
  input: unknown,
  fetcher: typeof fetch = fetch,
) {
  const request = await transaction(db, async (tx) => {
    await requireInstanceAdmin(tx, actorId);
    const kind =
      !!input && typeof input === 'object' && 'provider' in input ? input.provider : undefined;
    const isJikan = kind === 'jikan-api',
      isAniListApi = kind === 'anilist-api';
    const selected = isJikan
      ? jikanApiRequestSchema.parse(input)
      : isAniListApi
        ? aniListApiRequestSchema.parse(input)
        : providerCatalogRequestSchema.parse(input);
    // All Jikan steps on this instance share one budget, including CLI-like web
    // clients. Per-request authorization precedes both this counter and fetch.
    const key = createHash('sha256')
      .update(
        isJikan
          ? `jikan-api:${'service' in selected ? selected.service : 'tenrai'}:instance`
          : isAniListApi
            ? 'anilist-api:instance'
            : `anime-provider:${actorId}`,
      )
      .digest('hex');
    const row = (
      await tx.query(
        `INSERT INTO login_limits(email_key,attempts,window_start) VALUES($1,1,now())
    ON CONFLICT(email_key) DO UPDATE SET attempts=CASE WHEN login_limits.window_start<now()-interval '1 minute' THEN 1 ELSE login_limits.attempts+1 END,
    window_start=CASE WHEN login_limits.window_start<now()-interval '1 minute' THEN now() ELSE login_limits.window_start END RETURNING attempts`,
        [key],
      )
    ).rows[0];
    // AniList is shared by every admin on this instance and stays below its
    // published per-minute limit (currently 30 requests while degraded).
    const jikanBudget =
      jikanPacing['service' in selected && selected.service === 'jikan' ? 'jikan' : 'tenrai']
        .perMinute;
    return {
      selected,
      allowed: row.attempts <= (isJikan ? jikanBudget : isAniListApi ? 24 : 6),
    };
  });
  if (!request.allowed)
    throw new GameError(
      'RATE_LIMITED',
      'Too many provider preparations. Wait one minute before trying again.',
      429,
    );
  try {
    if (request.selected.provider === 'jikan-api')
      return await fetchJikanApiStep(request.selected, fetcher);
    if (request.selected.provider === 'anilist-api')
      return await fetchAniListApiStep(request.selected, fetcher);
    return await fetchSelectedProviderCatalog(request.selected, fetcher);
  } catch (error) {
    if (error instanceof ProviderCatalogError)
      throw new GameError(error.code, error.message, error.status);
    throw error;
  }
}
