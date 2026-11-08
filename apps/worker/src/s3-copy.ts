import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { remotePolicySchema, storageCredentialsSchema, type RemotePolicy } from './remote-config';
import { backupName } from './destination';
import { z } from 'zod';

export interface RemoteCopies {
  initialize(): Promise<void>;
  assertInitialized(): Promise<void>;
  copy(name: string, encrypted: string): Promise<void>;
  read(name: string): Promise<string>;
}
export function s3Client(policy: RemotePolicy, credentials: unknown): S3Client {
  const parsed = remotePolicySchema.parse(policy);
  return new S3Client({
    endpoint: parsed.endpoint,
    region: parsed.region,
    credentials: storageCredentialsSchema.parse(credentials),
    forcePathStyle: true,
    maxAttempts: 3,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_SUPPORTED',
    requestHandler: { connectionTimeout: 3000, requestTimeout: 15000 },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
}
export function s3Copies(client: S3Client, input: RemotePolicy, instanceId: string): RemoteCopies {
  const policy = remotePolicySchema.parse(input);
  z.string()
    .regex(/^[a-z0-9][a-z0-9-]{0,39}$/)
    .parse(instanceId);
  const prefix = `${policy.prefix}/card-engine-${instanceId}/`,
    marker = JSON.stringify({ schemaVersion: 1, kind: 'card-engine-s3-copy', instanceId });
  const key = (name: string) => {
    if (
      !backupName.test(name) &&
      name !== '.destination.json' &&
      !/^\.conditional-probe-[a-f0-9-]{36}$/.test(name)
    )
      throw new Error('Invalid remote generation name.');
    return prefix + name;
  };
  async function read(name: string): Promise<string> {
    const result = await client.send(
        new GetObjectCommand({ Bucket: policy.bucket, Key: key(name) }),
        { abortSignal: AbortSignal.timeout(20000) },
      ),
      stream = result.Body as Readable | undefined;
    if (!stream || typeof stream.destroy !== 'function')
      throw new Error('Remote body is unavailable.');
    const timer = setTimeout(() => stream.destroy(new Error('Remote read timed out.')), 20000);
    try {
      if (
        result.ContentLength !== undefined &&
        (result.ContentLength < 0 || result.ContentLength > policy.maxBytes)
      )
        throw new Error('Remote object exceeds the configured limit.');
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of stream) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > policy.maxBytes) throw new Error('Remote object exceeds the configured limit.');
        chunks.push(bytes);
      }
      return Buffer.concat(chunks).toString('utf8');
    } finally {
      clearTimeout(timer);
      stream.destroy();
    }
  }
  async function publish(name: string, content: string) {
    if (Buffer.byteLength(content) > policy.maxBytes)
      throw new Error('Backup exceeds the configured limit.');
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: policy.bucket,
          Key: key(name),
          Body: content,
          ContentType: 'application/json',
          IfNoneMatch: '*',
          ChecksumSHA256: createHash('sha256').update(content).digest('base64'),
        }),
        { abortSignal: AbortSignal.timeout(20000) },
      );
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412)
        throw error;
    }
    if ((await read(name)) !== content)
      throw new Error('Remote object differs from its local source.');
  }
  return {
    async initialize() {
      // Probe only a new random control object before touching real generations.
      // Providers that ignore conditional writes must fail initialization.
      const probe = `.conditional-probe-${randomUUID()}`;
      await publish(probe, 'conditional-write-original');
      let rejected = false;
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: policy.bucket,
            Key: key(probe),
            Body: 'conditional-write-replacement',
            ChecksumSHA256: createHash('sha256')
              .update('conditional-write-replacement')
              .digest('base64'),
            IfNoneMatch: '*',
          }),
          { abortSignal: AbortSignal.timeout(20000) },
        );
      } catch (error) {
        if (
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 412
        )
          rejected = true;
        else throw error;
      }
      if (!rejected || (await read(probe)) !== 'conditional-write-original')
        throw new Error('Conditional writes are not supported.');
      await publish('.destination.json', marker);
    },
    async assertInitialized() {
      if ((await read('.destination.json')) !== marker)
        throw new Error('Initialize the intended remote namespace first.');
    },
    async copy(name, content) {
      if (!backupName.test(name)) throw new Error('Invalid remote generation name.');
      await publish(name, content);
    },
    async read(name) {
      if (!backupName.test(name)) throw new Error('Invalid remote generation name.');
      return read(name);
    },
  };
}
