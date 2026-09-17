"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Entity } from "@/domain/entities";
import type { EntityType } from "@/domain/entity-types";
import type { Scene } from "@/domain/scenes";
import type { StoryWorld } from "@/domain/story-world";
import { fetchJson } from "@/ui/api-client";
import ConfirmDeleteModal from "@/ui/confirm-delete-modal";
import EntityDrawer from "@/ui/entity-drawer";
import { linkEntities } from "@/ui/link-entities";
import MentionInput from "@/ui/mention-input";
import SceneRenderer from "@/ui/scene-renderer";

type SaveState = "idle" | "saving" | "saved" | "error";
type Tab = "edit" | "preview";

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export default function SceneDetailScreen({
  storyId,
  sceneId,
}: {
  storyId: string;
  sceneId: string;
}) {
  const [scene, setScene] = useState<Scene | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entityTypes, setEntityTypes] = useState<EntityType[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [tab, setTab] = useState<Tab>("edit");
  const [drawerEntityId, setDrawerEntityId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const basePath = `/story/${storyId}`;
  const router = useRouter();
  const searchParams = useSearchParams();
  const highlightEntityId = searchParams.get("highlight") ?? undefined;

  useEffect(() => {
    let ignore = false;
    Promise.all([
      fetchJson<Scene>(
        `/api/stories/${encodeURIComponent(storyId)}/scenes/${encodeURIComponent(sceneId)}`,
        {  },
      ),
      fetchJson<StoryWorld>(
        `/api/stories/${encodeURIComponent(storyId)}`,
        {  },
      ),
    ])
      .then(([s, world]) => {
        if (ignore) return;
        setScene(s);
        setTitle(s.title ?? "");
        setContent(s.content ?? "");
        setEntities(world.entities);
        setEntityTypes(world.entityTypes);
      })
      .catch(() => {})
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [storyId, sceneId]);

  const save = useCallback(
    async (nextTitle: string, nextContent: string) => {
      setSaveState("saving");
      try {
        await fetchJson(
          `/api/stories/${encodeURIComponent(storyId)}/scenes/${encodeURIComponent(sceneId)}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: nextTitle || null, content: nextContent }),
          },
        );
        setSaveState("saved");
        window.dispatchEvent(
          new CustomEvent("novel-os:world-changed", { detail: { storyId } }),
        );
      } catch {
        setSaveState("error");
      }
    },
    [storyId, sceneId],
  );

  const scheduleSave = useCallback(
    (nextTitle: string, nextContent: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaveState("idle");
      saveTimer.current = setTimeout(() => save(nextTitle, nextContent), 1500);
    },
    [save],
  );

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  // Append event from the Narrate widget — re-fetch entities first so any
  // entities created during this narration session are included in linking.
  useEffect(() => {
    const handler = async (e: Event) => {
      const { sceneId: targetId, text } = (e as CustomEvent<{ sceneId: string; text: string }>).detail;
      if (targetId !== sceneId) return;

      let freshEntities = entities;
      try {
        const world = await fetchJson<StoryWorld>(
          `/api/stories/${encodeURIComponent(storyId)}`,
          {  },
        );
        freshEntities = world.entities;
        setEntities(world.entities);
        setEntityTypes(world.entityTypes);
      } catch {
        // fall back to cached entities
      }

      const linked = linkEntities(text, freshEntities);
      setContent((prev) => {
        const next = prev ? `${prev}\n\n${linked}` : linked;
        scheduleSave(title, next);
        return next;
      });
    };
    window.addEventListener("novel-os:scene-append", handler);
    return () => window.removeEventListener("novel-os:scene-append", handler);
  }, [sceneId, storyId, title, entities, scheduleSave]);

  if (loading) return <p className="text-sm text-neutral-400">Loading…</p>;
  if (!scene) {
    return (
      <p className="text-sm text-neutral-500">
        Scene not found.{" "}
        <Link href={basePath} className="underline">
          Back to story
        </Link>
      </p>
    );
  }

  const words = wordCount(content);

  return (
    <div className="mx-auto max-w-3xl">
      {/* Top bar */}
      <div className="mb-4 flex items-center justify-between">
        <Link href={basePath} className="text-sm text-neutral-400 hover:text-neutral-700">
          ← Story
        </Link>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50"
          >
            Delete scene
          </button>
          {confirmDelete && (
            <ConfirmDeleteModal
              title="Delete this scene?"
              description="The scene and all its prose will be permanently removed."
              onConfirm={async () => {
                await fetchJson(
                  `/api/stories/${encodeURIComponent(storyId)}/scenes/${encodeURIComponent(sceneId)}`,
                  { method: "DELETE" },
                );
                router.push(basePath);
              }}
              onClose={() => setConfirmDelete(false)}
            />
          )}
          {/* Edit / Preview tabs */}
          <div className="flex rounded-lg border border-neutral-200 p-0.5">
            {(["edit", "preview"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  tab === t ? "bg-neutral-900 text-white" : "text-neutral-500 hover:text-neutral-800"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <span className="text-xs text-neutral-400">
            {saveState === "saving" && "Saving…"}
            {saveState === "saved" && "Saved"}
            {saveState === "error" && "Save failed"}
            {saveState === "idle" && words > 0 && `${words} words`}
          </span>
        </div>
      </div>

      {/* Title — always editable regardless of tab */}
      <input
        type="text"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          scheduleSave(e.target.value, content);
        }}
        placeholder="Scene title…"
        className="mb-6 w-full border-none bg-transparent text-2xl font-semibold text-neutral-900 placeholder:text-neutral-300 focus:outline-none"
      />

      {/* Hint for edit mode */}
      {tab === "edit" && entities.length > 0 && (
        <p className="mb-3 text-xs text-neutral-400">
          Type <kbd className="rounded border border-neutral-200 bg-neutral-50 px-1 py-0.5 font-mono">@</kbd> to link a character, place, or object.
        </p>
      )}

      {/* Editor / Renderer */}
      {tab === "edit" ? (
        <MentionInput
          value={content}
          onChange={(next) => {
            setContent(next);
            scheduleSave(title, next);
          }}
          entities={entities}
          entityTypes={entityTypes}
          storyId={storyId}
          highlightEntityId={highlightEntityId}
          onEntityClick={(id) => setDrawerEntityId(id)}
          placeholder="Write your scene here… type @ to mention a character, place, or object."
        />
      ) : (
        <SceneRenderer
          content={content}
          storyId={storyId}
          entities={entities}
          entityTypes={entityTypes}
          highlightEntityId={highlightEntityId}
          onEntityClick={(id) => setDrawerEntityId(id)}
        />
      )}

      {/* Metadata footer */}
      {(scene.participantIds.length > 0 || scene.eventIds.length > 0) && (
        <div className="mt-8 border-t border-neutral-100 pt-4 text-xs text-neutral-400">
          {scene.participantIds.length > 0 && (
            <p>{scene.participantIds.length} participant(s) · extracted from dictation</p>
          )}
        </div>
      )}

      {/* Entity drawer */}
      {drawerEntityId && (() => {
        const entity = entities.find((e) => e.id === drawerEntityId);
        const entityType = entity ? entityTypes.find((t) => t.id === entity.entityTypeId) : undefined;
        return entity ? (
          <EntityDrawer
            entity={entity}
            entityType={entityType}
            storyId={storyId}
            onClose={() => setDrawerEntityId(null)}
          />
        ) : null;
      })()}
    </div>
  );
}
