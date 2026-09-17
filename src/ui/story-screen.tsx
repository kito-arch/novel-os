"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Chapter } from "@/domain/chapters";
import type { StoryEvent } from "@/domain/events";
import type { Scene } from "@/domain/scenes";
import type { StoryWorld } from "@/domain/story-world";
import ConfirmDeleteModal from "./confirm-delete-modal";
import EntityList from "./entity-list";
import EntityDetail from "./entity-detail";
import EntityCreateModal from "./entity-create-modal";
import { InlineError, PageSpinner } from "./loading";
import { fetchJson, studioHeaders } from "./api-client";

interface ChapterWithScenes extends Chapter {
  scenes: Scene[];
}

const CONFIDENCE_OPTIONS = ["explicit", "implied", "inferred", "unknown"] as const;

interface EditState {
  title: string;
  description: string;
  when: string;
  motivation: string;
  confidence: string;
  settingId: string;
  chapterId: string;
  sceneId: string;
  participants: string[];
  involvedObjects: string[];
  consequences: string;
}

function blankEdit(event?: StoryEvent, chapters?: ChapterWithScenes[]): EditState {
  const sceneId = event?.sceneId ?? "";
  const chapterId =
    sceneId && chapters
      ? (chapters.find((ch) => ch.scenes.some((sc) => sc.id === sceneId))?.id ?? "")
      : "";
  return {
    title: event?.title ?? "",
    description: event?.description ?? "",
    when: event?.when?.raw ?? "",
    motivation: event?.motivation ?? "",
    confidence: event?.confidence ?? "explicit",
    settingId: event?.settingId ?? "",
    chapterId,
    sceneId,
    participants: event?.participants ?? [],
    involvedObjects: event?.involvedObjects ?? [],
    consequences: (event?.consequences ?? []).join("\n"),
  };
}

function EventEditForm({
  storyId,
  world,
  chapters,
  eventId,
  initial,
  onSaved,
  onCancel,
}: {
  storyId: string;
  world: StoryWorld;
  chapters: ChapterWithScenes[];
  eventId: string | null;
  initial: EditState;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<EditState>(initial);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof EditState, v: unknown) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const toggleEntity = (arr: string[], id: string) =>
    arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];

  // Scenes filtered to the selected chapter (all scenes if no chapter picked).
  const filteredScenes =
    form.chapterId
      ? (chapters.find((ch) => ch.id === form.chapterId)?.scenes ?? [])
      : chapters.flatMap((ch) => ch.scenes);

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        title: form.title,
        description: form.description || null,
        when: form.when || null,
        motivation: form.motivation || null,
        confidence: form.confidence,
        settingId: form.settingId || null,
        sceneId: form.sceneId || null,
        participants: form.participants,
        involvedObjects: form.involvedObjects,
        consequences: form.consequences
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      };

      if (eventId) {
        await fetchJson(
          `/api/stories/${encodeURIComponent(storyId)}/events/${encodeURIComponent(eventId)}`,
          {
            method: "PATCH",
            headers: studioHeaders({ "content-type": "application/json" }),
            body: JSON.stringify(body),
          },
        );
      } else {
        await fetchJson(
          `/api/stories/${encodeURIComponent(storyId)}/events`,
          {
            method: "POST",
            headers: studioHeaders({ "content-type": "application/json" }),
            body: JSON.stringify(body),
          },
        );
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full rounded border border-neutral-300 px-2 py-1 text-sm text-neutral-900 bg-white focus:outline-none focus:border-neutral-500";
  const labelCls = "block text-xs font-medium text-neutral-500 mb-0.5";

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelCls}>Title *</label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            className={inputCls}
            placeholder="Event title"
          />
        </div>

        <div className="sm:col-span-2">
          <label className={labelCls}>Description</label>
          <textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            rows={2}
            placeholder="What happened?"
            className={`${inputCls} resize-none`}
          />
        </div>

        <div>
          <label className={labelCls}>When</label>
          <input
            type="text"
            value={form.when}
            onChange={(e) => set("when", e.target.value)}
            className={inputCls}
            placeholder="e.g. Chapter 3, dawn"
          />
        </div>

        <div>
          <label className={labelCls}>Confidence</label>
          <select
            value={form.confidence}
            onChange={(e) => set("confidence", e.target.value)}
            className={inputCls}
          >
            {CONFIDENCE_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c.charAt(0).toUpperCase() + c.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls}>Chapter</label>
          <select
            value={form.chapterId}
            onChange={(e) => {
              set("chapterId", e.target.value);
              set("sceneId", "");
            }}
            className={inputCls}
          >
            <option value="">— all chapters —</option>
            {chapters.map((ch) => (
              <option key={ch.id} value={ch.id}>
                {ch.title}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls}>Scene</label>
          <select
            value={form.sceneId}
            onChange={(e) => {
              const scId = e.target.value;
              set("sceneId", scId);
              if (scId) {
                const ch = chapters.find((c) => c.scenes.some((s) => s.id === scId));
                if (ch) set("chapterId", ch.id);
              }
            }}
            className={inputCls}
          >
            <option value="">— none —</option>
            {filteredScenes.map((sc) => (
              <option key={sc.id} value={sc.id}>
                {sc.title || "Untitled scene"}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls}>Setting (place)</label>
          <select
            value={form.settingId}
            onChange={(e) => set("settingId", e.target.value)}
            className={inputCls}
          >
            <option value="">— none —</option>
            {world.entities.map((en) => (
              <option key={en.id} value={en.id}>
                {en.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls}>Motivation</label>
          <input
            type="text"
            value={form.motivation}
            onChange={(e) => set("motivation", e.target.value)}
            className={inputCls}
            placeholder="Why did this happen?"
          />
        </div>

        <div>
          <label className={labelCls}>Consequences (one per line)</label>
          <textarea
            value={form.consequences}
            onChange={(e) => set("consequences", e.target.value)}
            rows={2}
            placeholder="Each line is one consequence"
            className={`${inputCls} resize-none`}
          />
        </div>
      </div>

      {world.entities.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Participants</label>
            <div className="max-h-28 overflow-y-auto rounded border border-neutral-200 p-2 space-y-1">
              {world.entities.map((en) => (
                <label key={en.id} className="flex items-center gap-2 text-xs text-neutral-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.participants.includes(en.id)}
                    onChange={() =>
                      set("participants", toggleEntity(form.participants, en.id))
                    }
                    className="rounded"
                  />
                  {en.name}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className={labelCls}>Involved objects / entities</label>
            <div className="max-h-28 overflow-y-auto rounded border border-neutral-200 p-2 space-y-1">
              {world.entities.map((en) => (
                <label key={en.id} className="flex items-center gap-2 text-xs text-neutral-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.involvedObjects.includes(en.id)}
                    onChange={() =>
                      set("involvedObjects", toggleEntity(form.involvedObjects, en.id))
                    }
                    className="rounded"
                  />
                  {en.name}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || !form.title.trim()}
          className="rounded-lg bg-neutral-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : eventId ? "Save" : "Create"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-neutral-200 px-3 py-1 text-xs text-neutral-600"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Caret({ open }: { open: boolean }) {
  return (
    <span className={`inline-block text-[9px] text-neutral-400 transition-transform ${open ? "rotate-90" : ""}`}>
      ▶
    </span>
  );
}

function EventRow({
  event,
  world,
  onEdit,
  onDelete,
}: {
  event: StoryEvent;
  world: StoryWorld;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const participants = event.participants
    .map((id) => world.entities.find((e) => e.id === id)?.name)
    .filter(Boolean);
  const setting = event.settingId
    ? world.entities.find((e) => e.id === event.settingId)?.name
    : null;

  return (
    <div className="group flex items-start justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-neutral-50">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-neutral-800">{event.title}</p>
        {event.description && (
          <p className="mt-0.5 text-xs text-neutral-500 leading-snug">{event.description}</p>
        )}
        {(event.when?.raw || setting || participants.length > 0) && (
          <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0 text-xs text-neutral-400">
            {event.when?.raw && <span>{event.when.raw}</span>}
            {setting && <span>@ {setting}</span>}
            {participants.length > 0 && <span>{participants.join(", ")}</span>}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-400 capitalize">
          {event.confidence}
        </span>
        <button type="button" onClick={onEdit} className="text-xs text-neutral-400 hover:text-neutral-700">
          Edit
        </button>
        <button type="button" onClick={onDelete} className="text-xs text-red-400 hover:text-red-600">
          Delete
        </button>
      </div>
    </div>
  );
}

function SceneGroup({
  scene,
  events,
  storyId,
  world,
  chapters,
  onChanged,
  editingId,
  setEditingId,
  onDelete,
}: {
  scene: Scene | null;
  events: StoryEvent[];
  storyId: string;
  world: StoryWorld;
  chapters: ChapterWithScenes[];
  onChanged: () => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  onDelete: (e: StoryEvent) => void;
}) {
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);

  const handleSaved = () => { setEditingId(null); setAdding(false); onChanged(); };

  return (
    <div className="py-1">
      {/* Scene header */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-neutral-100"
        >
          <Caret open={open} />
        </button>
        {scene ? (
          <Link
            href={`/story/${storyId}/scene/${scene.id}`}
            className="flex-1 truncate text-sm font-medium text-neutral-700 hover:text-neutral-900 hover:underline underline-offset-2"
          >
            {scene.title ?? "Untitled scene"}
          </Link>
        ) : (
          <span className="flex-1 text-sm font-medium text-neutral-400 italic">No scene</span>
        )}
        {events.length > 0 && (
          <span className="text-xs text-neutral-400">{events.length}</span>
        )}
        <button
          type="button"
          onClick={() => { setAdding(true); setOpen(true); }}
          className="text-xs text-neutral-400 hover:text-neutral-600 px-1"
        >
          + event
        </button>
      </div>

      {/* Events */}
      {open && (
        <div className="ml-5 mt-0.5 border-l border-neutral-100 pl-3">
          {events.map((event) =>
            editingId === event.id ? (
              <div key={event.id} className="py-2">
                <EventEditForm
                  storyId={storyId}
                  world={world}
                  chapters={chapters}
                  eventId={event.id}
                  initial={blankEdit(event, chapters)}
                  onSaved={handleSaved}
                  onCancel={() => setEditingId(null)}
                />
              </div>
            ) : (
              <EventRow
                key={event.id}
                event={event}
                world={world}
                onEdit={() => { setEditingId(event.id); setAdding(false); }}
                onDelete={() => onDelete(event)}
              />
            ),
          )}
          {events.length === 0 && !adding && (
            <p className="py-1 text-xs text-neutral-400">No events.</p>
          )}
          {adding && (
            <div className="py-2">
              <EventEditForm
                storyId={storyId}
                world={world}
                chapters={chapters}
                eventId={null}
                initial={blankEdit(scene ? { sceneId: scene.id } as StoryEvent : undefined, chapters)}
                onSaved={handleSaved}
                onCancel={() => setAdding(false)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChapterGroup({
  chapter,
  scenes,
  eventsByScene,
  storyId,
  world,
  chapters,
  onChanged,
  editingId,
  setEditingId,
  onDelete,
}: {
  chapter: ChapterWithScenes | null;
  scenes: Scene[];
  eventsByScene: Map<string, StoryEvent[]>;
  storyId: string;
  world: StoryWorld;
  chapters: ChapterWithScenes[];
  onChanged: () => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  onDelete: (e: StoryEvent) => void;
}) {
  const [open, setOpen] = useState(true);
  const sceneEventCount = scenes.reduce((n, s) => n + (eventsByScene.get(s.id)?.length ?? 0), 0);

  return (
    <div className="py-1">
      {/* Chapter header */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-neutral-100"
        >
          <Caret open={open} />
        </button>
        <span className="flex-1 text-sm font-semibold text-neutral-900">
          {chapter ? chapter.title : "No chapter"}
        </span>
        <span className="text-xs text-neutral-400">
          {scenes.length} scene{scenes.length !== 1 ? "s" : ""}
          {sceneEventCount > 0 && ` · ${sceneEventCount} event${sceneEventCount !== 1 ? "s" : ""}`}
        </span>
      </div>

      {/* Scenes */}
      {open && (
        <div className="ml-5 mt-0.5 border-l border-neutral-150 pl-3">
          {scenes.length === 0 && (
            <p className="py-1 text-xs text-neutral-400">No scenes.</p>
          )}
          {scenes.map((scene) => (
            <SceneGroup
              key={scene.id}
              scene={scene}
              events={eventsByScene.get(scene.id) ?? []}
              storyId={storyId}
              world={world}
              chapters={chapters}
              onChanged={onChanged}
              editingId={editingId}
              setEditingId={setEditingId}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StoryBibleSection({
  storyId,
  world,
  onChanged,
}: {
  storyId: string;
  world: StoryWorld;
  onChanged: () => void;
}) {
  const [chapters, setChapters] = useState<ChapterWithScenes[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StoryEvent | null>(null);

  useEffect(() => {
    let ignore = false;
    fetchJson<ChapterWithScenes[]>(
      `/api/stories/${encodeURIComponent(storyId)}/chapters`,
      { headers: studioHeaders() },
    )
      .then((data) => { if (!ignore) setChapters(data); })
      .catch(() => {});
    return () => { ignore = true; };
  }, [storyId, world.revision]);

  // Group scenes by chapterId, preserving chapter order
  const eventsByScene = new Map<string, StoryEvent[]>();
  const unattachedEvents: StoryEvent[] = [];
  for (const event of world.events) {
    if (event.sceneId) {
      const bucket = eventsByScene.get(event.sceneId) ?? [];
      bucket.push(event);
      eventsByScene.set(event.sceneId, bucket);
    } else {
      unattachedEvents.push(event);
    }
  }

  const sortedScenes = [...world.scenes].sort(
    (a, b) =>
      (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0) ||
      (a.position ?? 0) - (b.position ?? 0) ||
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  const chapterScenes = new Map<string, Scene[]>();
  const orphanScenes: Scene[] = [];
  for (const scene of sortedScenes) {
    if (scene.chapterId) {
      const bucket = chapterScenes.get(scene.chapterId) ?? [];
      bucket.push(scene);
      chapterScenes.set(scene.chapterId, bucket);
    } else {
      orphanScenes.push(scene);
    }
  }

  const hasContent = chapters.length > 0 || world.scenes.length > 0 || world.events.length > 0;
  if (!hasContent) return null;

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-neutral-900">Story Bible</h2>
      <div className="rounded-xl border border-neutral-200 bg-white px-4 py-2 divide-y divide-neutral-100">
        {/* Chapters */}
        {chapters.map((chapter) => (
          <ChapterGroup
            key={chapter.id}
            chapter={chapter}
            scenes={chapterScenes.get(chapter.id) ?? []}
            eventsByScene={eventsByScene}
            storyId={storyId}
            world={world}
            chapters={chapters}
            onChanged={onChanged}
            editingId={editingId}
            setEditingId={setEditingId}
            onDelete={setDeleteTarget}
          />
        ))}

        {/* Scenes with no chapter */}
        {orphanScenes.length > 0 && (
          <ChapterGroup
            key="__no_chapter__"
            chapter={null}
            scenes={orphanScenes}
            eventsByScene={eventsByScene}
            storyId={storyId}
            world={world}
            chapters={chapters}
            onChanged={onChanged}
            editingId={editingId}
            setEditingId={setEditingId}
            onDelete={setDeleteTarget}
          />
        )}

        {/* Events with no scene */}
        {unattachedEvents.length > 0 && (
          <SceneGroup
            key="__no_scene__"
            scene={null}
            events={unattachedEvents}
            storyId={storyId}
            world={world}
            chapters={chapters}
            onChanged={onChanged}
            editingId={editingId}
            setEditingId={setEditingId}
            onDelete={setDeleteTarget}
          />
        )}

        {!hasContent && (
          <p className="py-4 text-sm text-neutral-400">Nothing here yet. Narrate to add chapters, scenes, and events.</p>
        )}
      </div>

      {deleteTarget && (
        <ConfirmDeleteModal
          title={`Delete "${deleteTarget.title}"?`}
          description="This event will be permanently removed from the story timeline."
          onConfirm={async () => {
            await fetchJson(
              `/api/stories/${encodeURIComponent(storyId)}/events/${encodeURIComponent(deleteTarget.id)}`,
              { method: "DELETE", headers: studioHeaders() },
            );
            setDeleteTarget(null);
            onChanged();
          }}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </section>
  );
}

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
      window.dispatchEvent(
        new CustomEvent("novel-os:world-changed", { detail: { storyId } }),
      );
    },
    [storyId, state, reload],
  );

  if (state.kind === "loading") return <PageSpinner />;

  if (state.kind === "missing") {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 p-10 text-center">
        <h1 className="text-xl font-semibold text-neutral-900">
          This story {"hasn't"} started yet
        </h1>
        <p className="mt-2 text-sm text-neutral-500">
          Use the <span className="font-medium text-neutral-900">Narrate</span>{" "}
          button to dictate or write prose, or{" "}
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
    return <InlineError message={state.message} />;
  }

  const { world } = state;

  const selected = selectedId
    ? (world.entities.find((e) => e.id === selectedId) ?? null)
    : null;
  const selectedType = selected
    ? (world.entityTypes.find((t) => t.id === selected.entityTypeId) ?? null)
    : null;

  return (
    <div className="space-y-8">
      <input
        type="text"
        value={titleDraft ?? world.title}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          setTitleDraft(e.target.value);
          if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current);
          titleSaveTimer.current = setTimeout(
            () => saveTitle(e.target.value),
            1000,
          );
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
      {world.synopsis && (
        <p className="-mt-5 text-sm text-neutral-500">{world.synopsis}</p>
      )}

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
                ? 'No entities yet. Use Talk to dictate, or click "+ New" to create one directly.'
                : "Select an entity to view or edit its details."}
            </p>
          )}
        </div>
      </div>

      <StoryBibleSection storyId={storyId} world={world} onChanged={reload} />
    </div>
  );
}
