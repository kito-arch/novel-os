import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Media files land in the Next public dir so uploaded portraits/gallery images
// are served by the dev server at /uploads/<name>. MEDIA_DIR overrides the
// target in tests (point it at a temp dir so no repo files are written).
export interface MediaStorage {
  save(buffer: Buffer, originalName: string): Promise<string>;
}

const DEFAULT_MEDIA_DIR = "public/uploads";

export class LocalMediaStorage implements MediaStorage {
  constructor(private readonly dir: string = process.env.MEDIA_DIR ?? DEFAULT_MEDIA_DIR) {}

  async save(buffer: Buffer, originalName: string): Promise<string> {
    const extension = path.extname(originalName).toLowerCase();
    const filename = `${randomUUID()}${extension}`;
    await mkdir(this.dir, { recursive: true });
    await writeFile(path.join(this.dir, filename), buffer);
    return `/uploads/${filename}`;
  }
}

export const defaultMediaStorage: MediaStorage = new LocalMediaStorage();