import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { loadConfig } from "@/config";

export interface AudioStorage {
  /** Persist an audio buffer and return the S3 key (or local path) the worker
   *  uses to download it, plus a client-facing URL for the DB record. */
  save(
    buffer: Buffer,
    mimeType: string,
    meta: { userId: string; storyId: string },
  ): Promise<{ url: string; key: string }>;

  /** Download the buffer back by the key returned from save(). Used by the
   *  transcription worker when it submits audio to AssemblyAI. */
  loadBuffer(key: string): Promise<Buffer>;
}

// ── Local (dev) ──────────────────────────────────────────────────────────────

const DEFAULT_AUDIO_DIR = "public/uploads/audio";

export class LocalAudioStorage implements AudioStorage {
  constructor(private readonly dir: string = process.env.AUDIO_DIR ?? DEFAULT_AUDIO_DIR) {}

  async save(buffer: Buffer, mimeType: string): Promise<{ url: string; key: string }> {
    const ext = mimeToExt(mimeType);
    const filename = `${randomUUID()}${ext}`;
    await mkdir(this.dir, { recursive: true });
    const key = path.join(this.dir, filename);
    await writeFile(key, buffer);
    return { url: `/uploads/audio/${filename}`, key };
  }

  async loadBuffer(key: string): Promise<Buffer> {
    return readFile(key);
  }
}

// ── S3 ───────────────────────────────────────────────────────────────────────

export interface S3AudioStorageOptions {
  bucket: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  client?: S3Client;
}

export class S3AudioStorage implements AudioStorage {
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor(options: S3AudioStorageOptions) {
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
    mimeType: string,
    meta: { userId: string; storyId: string },
  ): Promise<{ url: string; key: string }> {
    const ext = mimeToExt(mimeType);
    const key = `audio/${meta.storyId}/${randomUUID()}${ext}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType || "application/octet-stream",
      }),
    );
    // Reuse the same /api/media proxy that images use — ownership is verified there.
    return { url: `/api/media/${key}`, key };
  }

  async loadBuffer(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) throw new Error(`S3 object ${key} has no body`);
    const bytes = await response.Body.transformToByteArray();
    return Buffer.from(bytes);
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

let storage: AudioStorage | null = null;

export function getAudioStorage(): AudioStorage {
  if (!storage) {
    const config = loadConfig();
    storage = config.S3_BUCKET
      ? new S3AudioStorage({
          bucket: config.S3_BUCKET,
          region: config.AWS_REGION ?? "us-east-1",
          accessKeyId: config.AWS_ACCESS_KEY_ID,
          secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
        })
      : new LocalAudioStorage();
  }
  return storage;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/flac": ".flac",
    "audio/x-m4a": ".m4a",
  };
  return map[mime] ?? ".webm";
}
