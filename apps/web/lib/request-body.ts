import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { GameError } from '@card-engine/core';

const unzip = promisify(gunzip);

/**
 * Reads a JSON object body with a byte cap, streaming instead of trusting
 * Content-Length. Large uploads (realm rosters, sounds) may arrive gzip
 * compressed from the browser, which keeps them under hosting request limits
 * such as Vercel's 4.5 MB. Compression is recognized by the gzip signature, so
 * it works whether or not a proxy kept the Content-Encoding header; the same
 * cap applies to the compressed and the decompressed size.
 */
export async function readJsonBody(
  request: Request,
  maximum = 16384,
): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new GameError('BAD_REQUEST', 'A JSON body is required.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new GameError('TOO_LARGE', 'Request is too large.', 413);
    }
    chunks.push(value);
  }
  let bytes = Buffer.concat(chunks);
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      bytes = await unzip(bytes, { maxOutputLength: maximum });
    } catch (error) {
      if (
        error instanceof RangeError ||
        (error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE'
      )
        throw new GameError('TOO_LARGE', 'Request is too large.', 413);
      throw new GameError('BAD_REQUEST', 'The compressed request could not be read.');
    }
  }
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch {
    throw new GameError('BAD_REQUEST', 'A JSON object is required.');
  }
}
