// Browser helpers for the JSON API. Errors keep the HTTP status so callers can
// tell a rejected request (4xx, safe to edit and resend) from an unknown outcome.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Bodies above this size are gzip compressed (rosters, sounds). */
export const compressAbove = 256 * 1024;

async function requestBody(input: unknown): Promise<{ body: BodyInit; gzip: boolean }> {
  const text = JSON.stringify(input);
  if (text.length < compressAbove || typeof CompressionStream === 'undefined')
    return { body: text, gzip: false };
  // Keeps large uploads under hosting limits (Vercel accepts 4.5 MB per
  // request); the server checks the decompressed size against the same cap.
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return { body: await new Response(stream).blob(), gzip: true };
}

export async function post(path: string, input: unknown) {
  const { body, gzip } = await requestBody(input);
  const response = await fetch(`/api/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
    },
    body,
  });
  const result = await response.json();
  if (!response.ok)
    throw new ApiError(result.error ?? 'The request could not be completed.', response.status);
  return result;
}
