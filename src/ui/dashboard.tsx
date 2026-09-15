"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { STUDIO_USER } from "@/ui/api-client";
import { EmptyState, PageSpinner, Spinner } from "@/ui/loading";
import { useToast } from "@/ui/toast";

export interface StoryEntry {
  id: string;
  title: string;
  createdAt: string;
}

async function fetchStories(): Promise<StoryEntry[]> {
  const res = await fetch("/api/stories", { headers: { "x-user-id": STUDIO_USER } });
  if (!res.ok) throw new Error(`Failed to load stories (${res.status})`);
  return res.json() as Promise<StoryEntry[]>;
}

function makeStoryId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `story-${Date.now().toString(36)}`;
}

export default function Dashboard() {
  const router = useRouter();
  const { toast } = useToast();
  const [stories, setStories] = useState<StoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchStories()
      .then(setStories)
      .catch((err: Error) => toast(err.message, "error"))
      .finally(() => setLoading(false));
  }, [toast]);

  const create = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const name = title.trim();
      if (!name || busy) return;
      setBusy(true);
      const id = makeStoryId();
      try {
        const res = await fetch("/api/stories", {
          method: "POST",
          headers: { "content-type": "application/json", "x-user-id": STUDIO_USER },
          body: JSON.stringify({ id, title: name }),
        });
        if (!res.ok) throw new Error(`Could not create story (${res.status})`);
        setTitle("");
        router.push(`/story/${id}`);
      } catch (err) {
        toast(err instanceof Error ? err.message : "Failed to create story", "error");
        setBusy(false);
      }
    },
    [title, busy, router, toast],
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
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
          className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {busy && <Spinner size="sm" />}
          Create
        </button>
      </form>

      {loading ? (
        <PageSpinner />
      ) : stories.length === 0 ? (
        <EmptyState message="No stories yet. Create your first one above." />
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
