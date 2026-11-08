/**
 * Request pacing per service, kept below each provider's published limits:
 * Tenrai allows 120 requests/minute and 4/second, the legacy public Jikan API
 * 60/minute and 3/second. `perMinute` is the instance-wide budget enforced by
 * the server; `delayMs` spaces one admin's sequential requests. Browser-safe:
 * no Node imports, so preparation pages can use it directly.
 */
export const jikanPacing = {
  tenrai: { delayMs: 650, perMinute: 100 },
  jikan: { delayMs: 1100, perMinute: 55 },
} as const;
