// Test-only preload for Docker/CLI wiring. Production has no fake storage switch.
import { S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { join } from 'node:path';
const root = '/fixture-s3';
function failure(name, status) {
  return Object.assign(new Error('Fictional storage error.'), {
    name,
    $metadata: { httpStatusCode: status },
  });
}
S3Client.prototype.send = async function (command) {
  const endpoint = await this.config.endpoint();
  if (endpoint.hostname !== 's3.fixture.test') throw new Error('Unexpected fixture target.');
  const input = command.input,
    path = join(
      root,
      createHash('sha256')
        .update(input.Bucket + '/' + input.Key)
        .digest('hex'),
    );
  if (command.constructor.name === 'PutObjectCommand') {
    if (input.IfNoneMatch !== '*') throw new Error('Fixture requires conditional creation.');
    const body = Buffer.from(input.Body);
    if (
      input.ChecksumSHA256 &&
      createHash('sha256').update(body).digest('base64') !== input.ChecksumSHA256
    )
      throw failure('BadDigest', 400);
    try {
      await writeFile(path, body, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error.code === 'EEXIST') throw failure('PreconditionFailed', 412);
      throw error;
    }
    return { $metadata: { httpStatusCode: 200 } };
  }
  if (command.constructor.name === 'GetObjectCommand') {
    try {
      const bytes = await readFile(path);
      return {
        Body: Readable.from([bytes]),
        ContentLength: bytes.length,
        $metadata: { httpStatusCode: 200 },
      };
    } catch (error) {
      if (error.code === 'ENOENT') throw failure('NoSuchKey', 404);
      throw error;
    }
  }
  throw new Error('Unexpected fixture storage operation.');
};
