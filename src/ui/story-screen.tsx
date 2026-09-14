"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { StoryWorld } from "@/domain/story-world";
import EntityList from "./entity-list";
import EntityDetail from "./entity-detail";
import EntityCreateModal from "./entity-create-modal";
import SceneCard from "./scene-card";
import { fetchJson, studioHeaders } from "./api-client";

type WorldState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; world: StoryWorld };

export default function StoryScreen({ storyId }: { storyId: string }) {
  const searchParams = useSearchParams();
  const [state, setState] = useState<WorldState>({ kind: "loading" });
  const filterParam = searchParams.get("s");
  const [activeType, setActiveType] = useState<string | null>(filterParam);
  const [prevFilter, setPrevFilter] = useState<string | null>(filterParam);
  if (prevFilter !== filterParam) {
    setPrevFilter(filterParam);
    setActiveType(filterParam);
  }
  const selectedId = searchParams.get("entity");
  const [refresh, setRefresh] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const basePath = `/story/${storyId}`;

  useEffect(() => {
    let ignore = false;
    fetchJson<StoryWorld>(`/api/stories/${encodeURIComponent(storyId)}`, {
      headers: studioHeaders(),
    })
      .then((world) => {
        if (!ignore) setState({ kind: "loaded", world });
      })
      .catch((error) => {
        if (ignore) return;
        const message = (error as Error).message;
        setState(
          message.includes("404") || message.includes("story not found")
            ? { kind: "missing" }
            : { kind: "error", message },
        );
      });
    return () => {
      ignore = true;
    };
  }, [storyId, refresh]);

  const reload = useCallback(() => setRefresh((v) => v + 1), []);

  // Must be declared before any early returns to satisfy Rules of Hooks.
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const titleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-sync: if the DB still has the placeholder title, pull the real one
  // from localStorage (set by the dashboard when the story was created).
  useEffect(() => {
    if (state.kind !== "loaded") return;
    if (state.world.title !== "Untitled story") return;
    try {
      const raw = window.localStorage.getItem("novel-os:stories");
      if (!raw) return;
      const entries = JSON.parse(raw) as Array<{ id: string; title: string }>;
      const match = entries.find((e) => e.id === storyId);
      if (!match || !match.title.trim() || match.title === "Untitled story") return;
      // Persist the real title to the DB and refresh.
      fetchJson(`/api/stories/${encodeURIComponent(storyId)}`, {
        method: "PATCH",
        headers: studioHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ title: match.title }),
      }).then(() => {
        reload();
        window.dispatchEvent(new CustomEvent("novel-os:world-changed", { detail: { storyId } }));
      }).catch(() => {});
    } catch {
      // localStorage unavailable or parse error — ignore
    }
  }, [state, storyId, reload]);

  const saveTitle = useCallback(
    async (next: string) => {
      if (state.kind !== "loaded") return;
      const trimmed = next.trim();
      if (!trimmed || trimmed === state.world.title) return;
      await fetchJson(`/api/stories/${encodeURIComponent(storyId)}`, {
        method: "PATCH",
        headers: studioHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ title: trimmed }),
      });
      reload();
      window.dispatchEvent(new CustomEvent("novel-os:world-changed", { detail: { storyId } }));
    },
    [storyId, state, reload],
  );

  if (state.kind === "loading") return <p className="text-sm text-neutral-500">Loading story bible…</p>;

  if (state.kind === "missing") {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 p-10 text-center">
        <h1 className="text-xl font-semibold text-neutral-900">This story {"hasn't"} started yet</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Use the{" "}
          <span className="font-medium text-neutral-900">Narrate</span>
          {" "}button to dictate or write prose, or{" "}
          <button
            type="button"
            className="font-medium text-neutral-900 underline"
            onClick={() => setShowCreate(true)}
          >
            create your first character
          </button>{" "}
          directly.
        </p>
        {showCreate && (
          <EntityCreateModal
            storyId={storyId}
            entityTypes={[]}
            initialTypeName="character"
            onCreated={() => {
              setShowCreate(false);
              reload();
            }}
            onClose={() => setShowCreate(false)}
          />
        )}
      </div>
    );
  }

  if (state.kind === "error") {
    return <p className="text-sm text-red-600">{state.message}</p>;
  }

  const { world } = state;

  const selected = selectedId
    ? world.entities.find((e) => e.id === selectedId) ?? null
    : null;
  const selectedType = selected
    ? world.entityTypes.find((t) => t.id === selected.entityTypeId) ?? null
    : null;

  const scenes = [...world.scenes].sort(
    (a, b) =>
      (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );

  return (
    <div className="space-y-8">
      <input
        type="text"
        value={titleDraft ?? world.title}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          setTitleDraft(e.target.value);
          if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current);
          titleSaveTimer.current = setTimeout(() => saveTitle(e.target.value), 1000);
        }}
        onBlur={(e) => {
          if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current);
          saveTitle(e.target.value);
          // Keep draft visible until reload() brings the refreshed title.
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        placeholder="Story title…"
        className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 -mx-2 text-2xl font-semibold text-neutral-900 placeholder:text-neutral-300 hover:border-neutral-200 focus:border-neutral-300 focus:outline-none transition-colors"
      />
      {world.synopsis && <p className="-mt-5 text-sm text-neutral-500">{world.synopsis}</p>}

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="rounded-xl border border-neutral-200 bg-neutral-50/50 p-4">
          <EntityList
            entities={world.entities}
            entityTypes={world.entityTypes}
            activeType={activeType}
            onTypeChange={setActiveType}
            basePath={basePath}
            storyId={storyId}
            onCreated={reload}
          />
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-5">
          {selected && selectedType ? (
            <EntityDetail
              key={selected.id}
              entity={selected}
              entityType={selectedType}
              storyId={storyId}
              onSaved={reload}
            />
          ) : (
            <p className="text-sm text-neutral-500">
              {world.entities.length === 0
                ? "No entities yet. Use Talk to dictate, or click \"+ New\" to create one directly."
                : "Select an entity to view or edit its details."}
            </p>
          )}
        </div>
      </div>

      {scenes.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-neutral-900">Scenes</h2>
          <div className="space-y-3">
            {scenes.map((scene) => (
              <Link key={scene.id} href={`${basePath}/scene/${scene.id}`} className="block hover:opacity-80">
                <SceneCard scene={scene} world={world} />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
