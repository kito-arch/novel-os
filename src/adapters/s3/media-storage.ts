import { randomUUID } from "node:crypto";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface S3MediaStorageOptions {
  bucket: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  client?: S3Client;
}

// Stores media files in S3 under {storyId}/{uuid}{ext}. The returned URL is
// the backend proxy path /api/media/{storyId}/{uuid}{ext} — the client always
// goes through that endpoint which verifies ownership before issuing a
// pre-signed redirect, so cross-user access is impossible even with a guessed URL.
export class S3MediaStorage {
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor(options: S3MediaStorageOptions) {
    this.bucket = options.bucket;
    this.client =
      options.client ??
      new S3Client({
        region: options.region,
        ...(options.accessKeyId && options.secretAccessKey
          ? { credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey } }
          : {}),
      });
  }

  async save(
    buffer: Buffer,
    originalName: string,
    meta: { userId: string; storyId: string },
  ): Promise<string> {
    const ext = path.extname(originalName).toLowerCase();
    const key = `${meta.storyId}/${randomUUID()}${ext}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: extToMime(ext),
      }),
    );
    return `/api/media/${key}`;
  }
}

function extToMime(ext: string): string {
  const map: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".svg": "image/svg+xml",
  };
  return map[ext] ?? "application/octet-stream";
}
