"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Chapter } from "@/domain/chapters";
import { coreEntityTypes } from "@/domain/builtins";
import type { Entity } from "@/domain/entities";
import type { EntityType } from "@/domain/entity-types";
import type { Scene } from "@/domain/scenes";
import type { StoryWorld } from "@/domain/story-world";
import { fetchJson, studioHeaders } from "./api-client";
import ChapterCreateModal from "./chapter-create-modal";
import ConfirmDeleteModal from "./confirm-delete-modal";
import EntityCreateModal from "./entity-create-modal";
import EntityTypeCreateModal from "./entity-type-create-modal";

interface ChapterWithScenes extends Chapter {
  scenes: Scene[];
}

function ChaptersSection({
  storyId,
  chapters,
  onAddChapter,
  onAddScene,
  onDeleted,
}: {
  storyId: string;
  chapters: ChapterWithScenes[];
  onAddChapter: () => void;
  onAddScene: (chapterId: string) => void;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [deleteChapterId, setDeleteChapterId] = useState<string | null>(null);
  const pathname = usePathname();
  const deleteTarget = chapters.find((c) => c.id === deleteChapterId);

  return (
    <>
    {deleteTarget && (
      <ConfirmDeleteModal
        title={`Delete "${deleteTarget.title}"?`}
        description="All scenes inside this chapter will also be deleted."
        onConfirm={async () => {
          await fetch(`/api/stories/${encodeURIComponent(storyId)}/chapters/${encodeURIComponent(deleteTarget.id)}`, {
            method: "DELETE",
          });
          setDeleteChapterId(null);
          onDeleted();
        }}
        onClose={() => setDeleteChapterId(null)}
      />
    )}
    <div>
      <div className="flex items-center justify-between rounded-md px-2 py-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-400 hover:text-neutral-600"
        >
          <span className={`text-[9px] transition-transform ${open ? "" : "-rotate-90"}`}>▾</span>
          Story
        </button>
        <button
          type="button"
          onClick={onAddChapter}
          title="New chapter"
          className="flex h-5 w-5 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
        >
          +
        </button>
      </div>

      {open && (
        <div className="mb-1 ml-3 space-y-1">
          {chapters.length === 0 ? (
            <button
              type="button"
              onClick={onAddChapter}
              className="w-full rounded px-2 py-1 text-left text-xs italic text-neutral-300 hover:text-neutral-500"
            >
              No chapters yet — add one
            </button>
          ) : (
            chapters.map((chapter) => (
              <div key={chapter.id}>
                <div className="flex items-center justify-between">
                  <span className="truncate px-2 py-0.5 text-xs font-medium text-neutral-500">
                    {chapter.title}
                  </span>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => onAddScene(chapter.id)}
                      title="New scene"
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-neutral-300 hover:bg-neutral-100 hover:text-neutral-600"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteChapterId(chapter.id)}
                      title="Delete chapter"
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-neutral-300 hover:bg-red-50 hover:text-red-500"
                    >
                      ×
                    </button>
                  </div>
                </div>
                <ul className="ml-2 space-y-0.5">
                  {chapter.scenes.length === 0 ? (
                    <li>
                      <button
                        type="button"
                        onClick={() => onAddScene(chapter.id)}
                        className="w-full rounded px-2 py-0.5 text-left text-xs italic text-neutral-300 hover:text-neutral-500"
                      >
                        Add first scene
                      </button>
                    </li>
                  ) : (
                    chapter.scenes.map((scene) => {
                      const href = `/story/${storyId}/scene/${scene.id}`;
                      const active = pathname === href;
                      return (
                        <li key={scene.id}>
                          <Link
                            href={href}
                            className={`block truncate rounded px-2 py-0.5 text-sm ${
                              active
                                ? "bg-neutral-900 text-white"
                                : "text-neutral-700 hover:bg-neutral-100"
                            }`}
                          >
                            {scene.title || <span className="italic text-neutral-400">Untitled scene</span>}
                          </Link>
                        </li>
                      );
                    })
                  )}
                </ul>
              </div>
            ))
          )}
        </div>
      )}
    </div>
    </>
  );
}

// Entity type sections always shown even with 0 entities — builtins that
// haven't been registered yet are displayed as empty sections.
function mergedTypes(registered: EntityType[]): EntityType[] {
  const names = new Set(registered.map((t) => t.name.toLowerCase()));
  return [...registered, ...coreEntityTypes.filter((t) => !names.has(t.name.toLowerCase()))];
}

function entityLink(storyId: string, entity: Entity): string {
  return `/story/${storyId}/entity/${entity.id}`;
}

interface EntitySectionProps {
  storyId: string;
  type: EntityType;
  entities: Entity[];
  onNew: (typeName: string) => void;
}

function EntitySection({ storyId, type, entities, onNew }: EntitySectionProps) {
  const [open, setOpen] = useState(true);
  const pathname = usePathname();
  const label = type.pluralName.charAt(0).toUpperCase() + type.pluralName.slice(1);

  return (
    <div>
      <div className="flex items-center justify-between rounded-md px-2 py-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-400 hover:text-neutral-600"
        >
          <span className={`text-[9px] transition-transform ${open ? "" : "-rotate-90"}`}>▾</span>
          {label}
        </button>
        <button
          type="button"
          onClick={() => onNew(type.name)}
          title={`New ${type.name}`}
          className="flex h-5 w-5 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
        >
          +
        </button>
      </div>

      {open && (
        <ul className="mb-1 ml-3 space-y-0.5">
          {entities.length === 0 ? (
            <li>
              <button
                type="button"
                onClick={() => onNew(type.name)}
                className="w-full rounded px-2 py-1 text-left text-xs text-neutral-300 italic hover:text-neutral-500"
              >
                No {type.pluralName} yet — add one
              </button>
            </li>
          ) : (
            entities.map((entity) => {
              const href = entityLink(storyId, entity);
              const active = pathname === href || pathname.includes(entity.id);
              return (
                <li key={entity.id}>
                  <Link
                    href={href}
                    className={`block truncate rounded px-2 py-1 text-sm ${
                      active
                        ? "bg-neutral-900 text-white"
                        : "text-neutral-700 hover:bg-neutral-100"
                    }`}
                  >
                    {entity.name}
                  </Link>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}

export default function Sidebar({ storyId }: { storyId: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [world, setWorld] = useState<StoryWorld | null>(null);
  const [chapters, setChapters] = useState<ChapterWithScenes[]>([]);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [creatingType, setCreatingType] = useState(false);
  const [creatingChapter, setCreatingChapter] = useState(false);
  const refreshRef = useRef(0);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let ignore = false;
    fetchJson<StoryWorld>(`/api/stories/${encodeURIComponent(storyId)}`, {
      headers: studioHeaders(),
    })
      .then((data) => { if (!ignore) setWorld(data); })
      .catch(() => {});
    return () => { ignore = true; };
  }, [storyId, refresh]);

  useEffect(() => {
    let ignore = false;
    fetchJson<ChapterWithScenes[]>(
      `/api/stories/${encodeURIComponent(storyId)}/chapters`,
      { headers: studioHeaders() },
    )
      .then((data) => { if (!ignore) setChapters(data); })
      .catch(() => {});
    return () => { ignore = true; };
  }, [storyId, refresh]);

  useEffect(() => {
    const onWorldChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ storyId: string }>).detail;
      if (detail.storyId === storyId) {
        refreshRef.current += 1;
        setRefresh(refreshRef.current);
      }
    };
    window.addEventListener("novel-os:world-changed", onWorldChanged);
    return () => window.removeEventListener("novel-os:world-changed", onWorldChanged);
  }, [storyId]);

  const base = `/story/${storyId}`;
  const isBible = pathname === base;

  const types = mergedTypes(world?.entityTypes ?? []);
  const entitiesByType = new Map<string, Entity[]>();
  for (const type of types) {
    entitiesByType.set(
      type.name,
      (world?.entities ?? []).filter((e) => e.entityTypeId === type.id),
    );
  }

  const handleCreated = () => {
    setCreating(null);
    refreshRef.current += 1;
    setRefresh(refreshRef.current);
  };

  const handleAddChapter = () => {
    setOpen(false);
    setCreatingChapter(true);
  };

  const confirmAddChapter = async (title: string) => {
    setCreatingChapter(false);
    const { id: chapterId } = await fetchJson<{ id: string }>(
      `/api/stories/${encodeURIComponent(storyId)}/chapters`,
      {
        method: "POST",
        headers: studioHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ title: title.trim() }),
      },
    );
    refreshRef.current += 1;
    setRefresh(refreshRef.current);
    // Immediately create a first scene in the new chapter and navigate to it
    const scene = await fetchJson<{ id: string }>(
      `/api/stories/${encodeURIComponent(storyId)}/chapters/${encodeURIComponent(chapterId)}/scenes`,
      {
        method: "POST",
        headers: studioHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({}),
      },
    );
    refreshRef.current += 1;
    setRefresh(refreshRef.current);
    router.push(`/story/${storyId}/scene/${scene.id}`);
  };

  const handleAddScene = async (chapterId: string) => {
    setOpen(false);
    const scene = await fetchJson<{ id: string }>(
      `/api/stories/${encodeURIComponent(storyId)}/chapters/${encodeURIComponent(chapterId)}/scenes`,
      {
        method: "POST",
        headers: studioHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({}),
      },
    );
    refreshRef.current += 1;
    setRefresh(refreshRef.current);
    router.push(`/story/${storyId}/scene/${scene.id}`);
  };

  return (
    <>
      <button
        className="fixed top-3 left-3 z-50 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-700 lg:hidden"
        onClick={() => setOpen((v) => !v)}
        aria-label="Toggle navigation"
      >
        ☰
      </button>

      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`${
          open ? "translate-x-0" : "-translate-x-full"
        } fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-neutral-200 bg-white transition-transform lg:static lg:translate-x-0`}
      >
        <div className="flex h-full flex-col gap-0.5 overflow-y-auto px-3 py-4">
          <Link
            href="/"
            className="mb-2 px-2 text-sm font-semibold text-neutral-400 hover:text-neutral-700"
          >
            ← Stories
          </Link>

          {world?.title && (
            <div className="mb-3 px-2 text-sm font-semibold text-neutral-800 truncate">
              {world.title}
            </div>
          )}

          <div className="my-2 border-t border-neutral-100" />

          <ChaptersSection
            storyId={storyId}
            chapters={chapters}
            onAddChapter={handleAddChapter}
            onAddScene={handleAddScene}
            onDeleted={() => { refreshRef.current += 1; setRefresh(refreshRef.current); }}
          />

          <div className="my-2 border-t border-neutral-100" />

          {types.map((type) => (
            <EntitySection
              key={type.name}
              storyId={storyId}
              type={type}
              entities={entitiesByType.get(type.name) ?? []}
              onNew={(typeName) => {
                setOpen(false);
                setCreating(typeName);
              }}
            />
          ))}

          <div className="my-2 border-t border-neutral-100" />

          <button
            type="button"
            onClick={() => { setOpen(false); setCreatingType(true); }}
            className="rounded-md px-2 py-1.5 text-left text-xs text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            + New entity type
          </button>

          <div className="my-2 border-t border-neutral-100" />

          <Link
            href={base}
            onClick={() => setOpen(false)}
            className={`rounded-md px-2 py-1.5 text-sm ${
              isBible ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"
            }`}
          >
            Story Bible
          </Link>
        </div>
      </aside>

      {creatingChapter && (
        <ChapterCreateModal
          onConfirm={confirmAddChapter}
          onClose={() => setCreatingChapter(false)}
        />
      )}

      {creating !== null && (
        <EntityCreateModal
          storyId={storyId}
          entityTypes={world?.entityTypes ?? []}
          initialTypeName={creating}
          onCreated={handleCreated}
          onClose={() => setCreating(null)}
        />
      )}

      {creatingType && (
        <EntityTypeCreateModal
          storyId={storyId}
          onCreated={(typeName) => {
            setCreatingType(false);
            refreshRef.current += 1;
            setRefresh(refreshRef.current);
            // Open the entity-create modal for the new type immediately
            setCreating(typeName);
          }}
          onClose={() => setCreatingType(false)}
        />
      )}
    </>
  );
}
