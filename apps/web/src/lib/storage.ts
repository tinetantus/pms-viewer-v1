import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

function local() {
  if (process.env.STORAGE_DRIVER !== 'local') return false;
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_LOCAL_STORAGE !== 'true')
    throw new Error('Production requires private S3 storage.');
  return true;
}
function location(key: string) {
  if (!/^[a-zA-Z0-9/_-]+(?:\.[a-z0-9]+)?$/.test(key) || key.includes('..'))
    throw new Error('Invalid storage key');
  const root = process.env.LOCAL_STORAGE_PATH;
  if (!root || !path.isAbsolute(root)) throw new Error('LOCAL_STORAGE_PATH must be absolute');
  return path.join(root, key);
}
function client() {
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'auto',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
}
export async function putObject(key: string, data: Uint8Array, mime: string) {
  if (local()) {
    const file = location(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data, { flag: 'wx' });
  } else
    await client().send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: data,
        ContentType: mime,
        IfNoneMatch: '*',
      }),
    );
}
export async function getObject(key: string) {
  if (local()) return readFile(location(key));
  const response = await client().send(
    new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
  );
  if (!response.Body) throw new Error('Stored object is unavailable');
  return Buffer.from(await response.Body.transformToByteArray());
}
export async function storageReady() {
  if (local()) {
    await mkdir(process.env.LOCAL_STORAGE_PATH!, { recursive: true });
    await access(process.env.LOCAL_STORAGE_PATH!);
  } else
    await client().send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET }), {
      abortSignal: AbortSignal.timeout(5000),
    });
}
