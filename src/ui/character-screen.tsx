"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { StoryWorld } from "@/domain/story-world";
import { fetchJson } from "@/ui/api-client";
import CharacterSheet from "@/ui/character-sheet";
import EntityDetail from "@/ui/entity-detail";
import EntityReferences from "@/ui/entity-references";
import MediaUpload from "@/ui/media-upload";

type Detail =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; world: StoryWorld };

export default function CharacterScreen({ storyId, entityId }: { storyId: string; entityId: string }) {
  const [detail, setDetail] = useState<Detail>({ kind: "loading" });
  const [tab, setTab] = useState<"overview" | "references" | "edit">("overview");
  const [refresh, setRefresh] = useState(0);
  const basePath = `/story/${storyId}`;

  useEffect(() => {
    let ignore = false;
    fetchJson<StoryWorld>(`/api/stories/${encodeURIComponent(storyId)}`, {

    })
      .then((world) => {
        if (!ignore) setDetail({ kind: "loaded", world });
      })
      .catch((error) => {
        if (ignore) return;
        const message = (error as Error).message;
        setDetail(
          message.includes("404") || message.includes("not found")
            ? { kind: "missing" }
            : { kind: "error", message },
        );
      });
    return () => {
      ignore = true;
    };
  }, [storyId, refresh]);

  if (detail.kind === "loading") return <p className="text-sm text-neutral-500">Loading…</p>;
  if (detail.kind === "missing") {
    return (
      <p className="text-sm text-neutral-500">
        Character not found.{" "}
        <Link href={basePath} className="underline">
          Back to story
        </Link>
      </p>
    );
  }
  if (detail.kind === "error") return <p className="text-sm text-red-600">{detail.message}</p>;

  const { world } = detail;
  const entity = world.entities.find((e) => e.id === entityId);
  if (!entity) {
    return (
      <p className="text-sm text-neutral-500">
        Character not found.{" "}
        <Link href={basePath} className="underline">
          Back to story
        </Link>
      </p>
    );
  }
  const entityType = world.entityTypes.find((t) => t.id === entity.entityTypeId);
  if (!entityType || entityType.baseKind !== "character") {
    return (
      <p className="text-sm text-neutral-500">
        This is not a character.{" "}
        <Link href={basePath} className="underline">
          Back to story
        </Link>
      </p>
    );
  }

  const sceneCount = world.scenes.filter((s) => s.participantIds.includes(entity.id)).length;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <Link href={basePath} className="text-sm text-neutral-500 hover:text-neutral-800">
          ← Story
        </Link>
      </div>

      <div className="mb-6 flex gap-2">
        {(["overview", "references", "edit"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1 text-sm font-medium ${
              tab === t ? "bg-neutral-900 text-white" : "bg-neutral-200 text-neutral-600"
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "references" ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-400">
            Story references
          </h2>
          <EntityReferences storyId={storyId} entityId={entityId} />
        </div>
      ) : tab === "overview" ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-6">
          <CharacterSheet
            entity={entity}
            entityType={entityType}
            entitiesById={new Map(world.entities.map((e) => [e.id, e]))}
            relationships={world.relationships}
            facts={world.facts}
            sceneCount={sceneCount}
          />
          <div className="mt-5 flex gap-2 border-t border-neutral-100 pt-4">
            <MediaUpload
              storyId={storyId}
              entityId={entity.id}
              role="portrait"
              label={entity.media.some((m) => m.role === "portrait") ? "Replace portrait" : "Upload portrait"}
              onUploaded={() => setRefresh((v) => v + 1)}
            />
            <MediaUpload
              storyId={storyId}
              entityId={entity.id}
              role="gallery"
              label="Add to gallery"
              onUploaded={() => setRefresh((v) => v + 1)}
            />
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-neutral-200 bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-neutral-900">Edit {entity.name}</h2>

          <EntityDetail
            key={entity.id}
            entity={entity}
            entityType={entityType}
            storyId={storyId}
            onSaved={() => setRefresh((v) => v + 1)}
          />
        </div>
      )}
    </div>
  );
}
