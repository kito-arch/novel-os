"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageSpinner, Spinner } from "@/ui/loading";
import { useToast } from "@/ui/toast";
import { logout } from "@/ui/api-client";

export interface StoryEntry {
  id: string;
  title: string;
  coverUrl: string | null;
  createdAt: string;
}

async function fetchStories(): Promise<StoryEntry[]> {
  const res = await fetch("/api/stories");
  if (!res.ok) throw new Error(`Failed to load stories (${res.status})`);
  return res.json() as Promise<StoryEntry[]>;
}

function makeStoryId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `story-${Date.now().toString(36)}`;
}

// Gradient palettes for the default book cover — deterministic from story id.
const COVER_GRADIENTS = [
  ["#1a1a2e", "#16213e"],
  ["#2d1b33", "#1a0a2e"],
  ["#0f2027", "#203a43"],
  ["#1c3a1c", "#0a1f0a"],
  ["#2c1810", "#1a0a05"],
  ["#1a1040", "#0d0820"],
  ["#2a1530", "#150a20"],
  ["#0a2a2a", "#051515"],
];

function coverGradient(id: string): [string, string] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const pair = COVER_GRADIENTS[h % COVER_GRADIENTS.length]!;
  return pair as [string, string];
}

function BookCover({
  story,
  onCoverChange,
}: {
  story: StoryEntry;
  onCoverChange: (url: string | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [colors] = useState(() => coverGradient(story.id));

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/stories/${encodeURIComponent(story.id)}/cover`, {
        method: "POST",
        body: form,
      });
      if (res.ok) {
        const { url } = await res.json() as { url: string };
        onCoverChange(url);
      }
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <div className="group/cover relative">
      {/* Book shape */}
      <div
        className="relative h-52 w-36 select-none overflow-hidden rounded-r-lg"
        style={{
          boxShadow:
            "5px 5px 16px rgba(0,0,0,0.35), inset -5px 0 10px rgba(0,0,0,0.25)",
        }}
      >
        {/* Spine shadow */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-4"
          style={{
            background:
              "linear-gradient(to right, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.0) 100%)",
          }}
        />
        {/* Cover */}
        {story.coverUrl ? (
          <img
            src={story.coverUrl}
            alt={story.title}
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <div
            className="flex h-full w-full flex-col items-center justify-center gap-3 p-4"
            style={{
              background: `linear-gradient(160deg, ${colors[0]} 0%, ${colors[1]} 100%)`,
            }}
          >
            {/* Default book icon */}
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              className="opacity-30"
            >
              <path
                d="M4 4h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"
                stroke="white"
                strokeWidth="1.5"
                fill="none"
              />
              <path
                d="M14 4l4 2v14l-4-2"
                stroke="white"
                strokeWidth="1.5"
                fill="none"
              />
              <line x1="6" y1="9" x2="12" y2="9" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
              <line x1="6" y1="12" x2="12" y2="12" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
              <line x1="6" y1="15" x2="10" y2="15" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <span className="text-center text-xs font-medium leading-tight text-white/40">
              {story.title.slice(0, 20)}
            </span>
          </div>
        )}

        {/* Upload overlay */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity group-hover/cover:opacity-100">
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); fileRef.current?.click(); }}
            disabled={uploading}
            className="flex flex-col items-center gap-1 text-white/90 hover:text-white"
          >
            {uploading ? (
              <Spinner size="sm" />
            ) : (
              <>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  <polyline points="17 8 12 3 7 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  <line x1="12" y1="3" x2="12" y2="15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                <span className="text-[10px] font-medium">Set cover</span>
              </>
            )}
          </button>
          {story.coverUrl && (
            <button
              type="button"
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                await fetch(`/api/stories/${encodeURIComponent(story.id)}/cover`, {
                  method: "DELETE",
                });
                onCoverChange(null);
              }}
              className="text-[10px] text-white/60 hover:text-white/90"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onClick={(e) => e.stopPropagation()}
        onChange={handleFile}
      />
    </div>
  );
}

function StoryCard({
  story,
  onCoverChange,
}: {
  story: StoryEntry;
  onCoverChange: (id: string, url: string | null) => void;
}) {
  return (
    <div className="group flex flex-col items-center gap-2">
      <Link href={`/story/${story.id}`} className="block">
        <BookCover
          story={story}
          onCoverChange={(url) => onCoverChange(story.id, url)}
        />
      </Link>
      <div className="w-36 text-center">
        <Link
          href={`/story/${story.id}`}
          className="block truncate text-sm font-medium text-neutral-800 hover:text-neutral-900"
        >
          {story.title}
        </Link>
        <p className="text-xs text-neutral-400">
          {new Date(story.createdAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </p>
      </div>
    </div>
  );
}

function NewStoryCard({ onCreate }: { onCreate: (title: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await onCreate(title.trim());
      setTitle("");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group/new flex h-52 w-36 flex-col items-center justify-center gap-3 rounded-r-lg border-2 border-dashed border-neutral-300 text-neutral-400 transition-colors hover:border-neutral-400 hover:text-neutral-600"
          style={{ boxShadow: "5px 5px 16px rgba(0,0,0,0.06)" }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
            <line x1="12" y1="8" x2="12" y2="16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <line x1="8" y1="12" x2="16" y2="12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span className="text-xs font-medium">New Story</span>
        </button>
        <div className="h-9 w-36" />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="flex h-52 w-36 flex-col items-center justify-center gap-3 rounded-r-lg bg-neutral-50 px-3"
        style={{ boxShadow: "5px 5px 16px rgba(0,0,0,0.08)" }}
      >
        <form onSubmit={submit} className="w-full space-y-2">
          <input
            ref={inputRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Story title…"
            className="w-full rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-900 focus:border-neutral-500 focus:outline-none"
          />
          <div className="flex gap-1">
            <button
              type="submit"
              disabled={busy || !title.trim()}
              className="flex-1 rounded bg-neutral-900 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {busy ? "…" : "Create"}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setTitle(""); }}
              className="rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-500"
            >
              ✕
            </button>
          </div>
        </form>
      </div>
      <div className="h-9 w-36" />
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const { toast } = useToast();

  async function handleLogout() {
    await logout();
    router.push("/auth");
    router.refresh();
  }
  const [stories, setStories] = useState<StoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetchStories()
      .then(setStories)
      .catch((err: Error) => toast(err.message, "error"))
      .finally(() => setLoading(false));
  }, [toast]);

  const create = useCallback(
    async (title: string) => {
      const id = makeStoryId();
      const res = await fetch("/api/stories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, title }),
      });
      if (!res.ok) throw new Error(`Could not create story (${res.status})`);
      router.push(`/story/${id}`);
    },
    [router],
  );

  const handleCoverChange = useCallback((id: string, url: string | null) => {
    setStories((prev) =>
      prev.map((s) => (s.id === id ? { ...s, coverUrl: url } : s)),
    );
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? stories.filter((s) => s.title.toLowerCase().includes(q))
    : stories;

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="mx-auto max-w-5xl px-6 py-14">
        {/* Header */}
        <div className="mb-10 flex items-center justify-between">
          <div className="text-center flex-1">
            <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">Novel OS</h1>
            <p className="mt-1 text-sm text-neutral-500">A living story bible, built by talking.</p>
          </div>
          <button
            onClick={handleLogout}
            className="absolute right-6 top-14 text-sm text-neutral-400 hover:text-neutral-700 transition-colors"
          >
            Sign out
          </button>
        </div>

        {/* Search */}
        <div className="mx-auto mb-10 max-w-sm">
          <div className="relative">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your stories…"
              className="w-full rounded-xl border border-neutral-200 bg-white py-2.5 pl-9 pr-4 text-sm text-neutral-900 placeholder:text-neutral-400 shadow-sm focus:border-neutral-400 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex justify-center py-20">
            <PageSpinner />
          </div>
        ) : (
          <>
            {q && filtered.length === 0 ? (
              <p className="py-16 text-center text-sm text-neutral-400">
                No stories matching &ldquo;{query}&rdquo;
              </p>
            ) : (
              <div className="flex flex-wrap gap-8 justify-center sm:justify-start">
                {filtered.map((story) => (
                  <StoryCard
                    key={story.id}
                    story={story}
                    onCoverChange={handleCoverChange}
                  />
                ))}
                {!q && <NewStoryCard onCreate={create} />}
              </div>
            )}
            {!q && stories.length === 0 && !loading && (
              <p className="mt-4 text-center text-sm text-neutral-400">
                No stories yet — create your first one above.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
