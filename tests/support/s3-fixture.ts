import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';
import type { RemotePolicy } from '../../apps/worker/src/remote-config';

type Request = {
  method: string;
  hostname: string;
  protocol: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
};
export const fixtureRemote: RemotePolicy = {
  schemaVersion: 1,
  endpoint: 'https://s3.fixture.test',
  region: 'us-east-1',
  bucket: 'fixture-bucket',
  prefix: 'backups',
  credentialsFile: '/private/fixture-credentials.json',
  maxBytes: 64 * 1024 * 1024,
};
export const fixtureCredentials = {
  accessKeyId: 'FICTIONALACCESSKEY',
  secretAccessKey: 'fictional-storage-secret-key-for-tests',
};
export function s3Fixture() {
  const objects = new Map<string, Buffer>(),
    requests: { method: string; key: string; headers: Record<string, string> }[] = [],
    corruptReads = new Set<string>();
  const state = {
    ignoreConditions: false,
    deny: false,
    failPutOnce: false,
    losePutResponseOnce: false,
  };
  async function body(value: unknown): Promise<Buffer> {
    if (typeof value === 'string') return Buffer.from(value);
    if (Buffer.isBuffer(value)) return value;
    if (!value) return Buffer.alloc(0);
    const chunks: Buffer[] = [];
    for await (const chunk of value as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
  const reply = (
    statusCode: number,
    content: Buffer | string = '',
    headers: Record<string, string> = {},
  ) => ({
    response: {
      statusCode,
      headers: { 'content-length': String(Buffer.byteLength(content)), ...headers },
      body: Readable.from([Buffer.isBuffer(content) ? content : Buffer.from(content)]),
    },
  });
  const error = (code: string, status: number) =>
    reply(
      status,
      `<Error><Code>${code}</Code><Message>Fictional storage failure</Message></Error>`,
      { 'content-type': 'application/xml' },
    );
  const handler = {
    async handle(request: Request) {
      const key = decodeURIComponent(request.path);
      requests.push({ method: request.method, key, headers: request.headers });
      if (request.hostname !== 's3.fixture.test' || request.protocol !== 'https:')
        throw new Error('Unexpected network target in fixture.');
      if (state.deny) return error('AccessDenied', 403);
      if (request.method === 'PUT') {
        if (state.failPutOnce) {
          state.failPutOnce = false;
          throw new Error('Fictional transport interruption.');
        }
        if (request.headers['if-none-match'] === '*' && objects.has(key) && !state.ignoreConditions)
          return error('PreconditionFailed', 412);
        const bytes = await body(request.body),
          checksum = request.headers['x-amz-checksum-sha256'];
        if (checksum && checksum !== createHash('sha256').update(bytes).digest('base64'))
          return error('BadDigest', 400);
        objects.set(key, bytes);
        if (state.losePutResponseOnce) {
          state.losePutResponseOnce = false;
          throw new Error('Fictional lost response after commit.');
        }
        return reply(200, '', { etag: '"fixture-etag"' });
      }
      if (request.method === 'GET') {
        const content = objects.get(key);
        if (!content) return error('NoSuchKey', 404);
        return reply(200, corruptReads.has(key) ? Buffer.from('corrupted fixture read') : content, {
          etag: '"fixture-etag"',
        });
      }
      return error('NotImplemented', 501);
    },
  };
  const client = new S3Client({
    endpoint: fixtureRemote.endpoint,
    region: fixtureRemote.region,
    credentials: { ...fixtureCredentials },
    forcePathStyle: true,
    maxAttempts: 1,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    requestHandler: handler,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  const key = (name: string, instance = 'fixture') =>
    `/${fixtureRemote.bucket}/${fixtureRemote.prefix}/card-engine-${instance}/${name}`;
  return { client, objects, requests, corruptReads, state, key };
}
