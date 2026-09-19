import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3MediaStorage } from "@/adapters/s3/media-storage";
import { loadConfig } from "@/config";

export interface MediaUploadMeta {
  userId: string;
  storyId: string;
}

export interface MediaStorage {
  save(
    buffer: Buffer,
    originalName: string,
    meta: MediaUploadMeta,
  ): Promise<string>;
}

// Development fallback: writes to Next.js public/uploads so the dev server
// serves them at /uploads/<name>. No auth — only used when S3_BUCKET is unset.
const DEFAULT_MEDIA_DIR = "public/uploads";

export class LocalMediaStorage implements MediaStorage {
  constructor(
    private readonly dir: string = process.env.MEDIA_DIR ?? DEFAULT_MEDIA_DIR,
  ) {}

  async save(
    buffer: Buffer,
    originalName: string,
    _meta: MediaUploadMeta,
  ): Promise<string> {
    const extension = path.extname(originalName).toLowerCase();
    const filename = `${randomUUID()}${extension}`;
    await mkdir(this.dir, { recursive: true });
    await writeFile(path.join(this.dir, filename), buffer);
    return `/uploads/${filename}`;
  }
}

let storage: MediaStorage | null = null;

export function getMediaStorage(): MediaStorage {
  if (!storage) {
    const config = loadConfig();
    storage = config.S3_BUCKET
      ? new S3MediaStorage({
          bucket: config.S3_BUCKET,
          region: config.AWS_REGION ?? "us-east-1",
          accessKeyId: config.AWS_ACCESS_KEY_ID,
          secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
        })
      : new LocalMediaStorage();
  }
  return storage;
}

// Legacy export kept for the test seam in the media route.
export const defaultMediaStorage: MediaStorage = {
  save: (buffer, name, meta) => getMediaStorage().save(buffer, name, meta),
};

// Resolves a stored media key to a URL the client can use directly.
// - Local public paths (starting with /) are returned unchanged.
// - Legacy /api/media/ proxy paths written before this refactor are unwrapped
//   to their S3 key and presigned.
// - Raw S3 keys are presigned with a 1-hour expiry.
// - When S3 is not configured (dev/test without a bucket) the key is returned
//   as-is so local paths still work and tests don't need real AWS credentials.
export async function resolveMediaUrl(key: string | null): Promise<string | null> {
  if (!key) return null;
  const legacyPrefix = "/api/media/";
  if (key.startsWith(legacyPrefix)) return resolveMediaUrl(key.slice(legacyPrefix.length));
  if (key.startsWith("/")) return key;
  const config = loadConfig();
  if (!config.S3_BUCKET) return key;
  const client = new S3Client({
    region: config.AWS_REGION ?? "us-east-1",
    ...(config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY
      ? { credentials: { accessKeyId: config.AWS_ACCESS_KEY_ID, secretAccessKey: config.AWS_SECRET_ACCESS_KEY } }
      : {}),
  });
  return getSignedUrl(client, new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }), { expiresIn: 3600 });
}
