import { randomUUID } from "node:crypto";
import type { AudioStorage } from "@/server/audio-storage";

export class MockAudioStorage implements AudioStorage {
  private readonly store = new Map<string, Buffer>();

  async save(buffer: Buffer): Promise<{ url: string; key: string }> {
    const key = `mock-audio-${randomUUID()}`;
    this.store.set(key, buffer);
    return { url: `/uploads/audio/${key}`, key };
  }

  async loadBuffer(key: string): Promise<Buffer> {
    return this.store.get(key) ?? Buffer.alloc(0);
  }
}
