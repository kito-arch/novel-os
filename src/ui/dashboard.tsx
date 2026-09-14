"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, useSyncExternalStore } from "react";

const STORIES_KEY = "novel-os:stories";

export interface StoryEntry {
  id: string;
  title: string;
  createdAt: string;
}

const listeners = new Set<() => void>();
const SERVER_SNAPSHOT: StoryEntry[] = [];

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

// useSyncExternalStore requires getSnapshot to be referentially stable between
// changes. Rather than re-parse localStorage (a new array + new objects every
// call, which React flags as an uncached snapshot and can loop), cache the
// parsed value and only rebuild it when the raw stored string actually changes.
let cachedRaw: string | null = null;
let cachedStories: StoryEntry[] = SERVER_SNAPSHOT;

function updateCacheFromRaw(raw: string | null): StoryEntry[] {
  cachedRaw = raw;
  if (raw === null) {
    cachedStories = [];
    return cachedStories;
  }
  try {
    cachedStories = JSON.parse(raw) as StoryEntry[];
  } catch {
    cachedStories = [];
  }
  return cachedStories;
}

function snapshotStories(): StoryEntry[] {
  if (typeof window === "undefined") return SERVER_SNAPSHOT;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORIES_KEY);
  } catch {
    return cachedStories;
  }
  return raw === cachedRaw ? cachedStories : updateCacheFromRaw(raw);
}

function writeStories(next: StoryEntry[]): void {
  const raw = JSON.stringify(next);
  window.localStorage.setItem(STORIES_KEY, raw);
  updateCacheFromRaw(raw);
  listeners.forEach((listener) => listener());
}

function makeStoryId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `story-${Date.now().toString(36)}`;
}

export default function Dashboard() {
  const router = useRouter();
  const stories = useSyncExternalStore(subscribe, snapshotStories, () => SERVER_SNAPSHOT);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const create = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const name = title.trim();
      if (!name || busy) return;
      setBusy(true);
      const id = makeStoryId();
      const entry: StoryEntry = { id, title: name, createdAt: new Date().toISOString() };
      writeStories([entry, ...cachedStories]);
      // Persist title to DB so the story never opens as "Untitled story".
      await fetch(`/api/stories/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: name }),
      });
      setTitle("");
      setBusy(false);
      router.push(`/story/${id}`);
    },
    [title, busy, router],
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-1 text-3xl font-semibold text-neutral-900">Novel OS</h1>
      <p className="mb-10 text-sm text-neutral-500">
        A living story bible, built by talking.
      </p>

      <form onSubmit={create} className="mb-10 flex gap-2">
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="New story title…"
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
        <button
          type="submit"
          disabled={busy || !title.trim()}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          Create
        </button>
      </form>

      {stories.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
          No stories yet. Create your first one above.
        </p>
      ) : (
        <ul className="space-y-2">
          {stories.map((story) => (
            <li key={story.id}>
              <Link
                href={`/story/${story.id}`}
                className="flex items-baseline justify-between rounded-xl border border-neutral-200 bg-white px-4 py-3 hover:border-neutral-300"
              >
                <span className="font-medium text-neutral-800">{story.title}</span>
                <span className="text-xs text-neutral-400">
                  {new Date(story.createdAt).toLocaleDateString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}