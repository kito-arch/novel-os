"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { BASE_KIND_CATALOG } from "@/domain/base-kinds";
import type { Entity, MediaRef } from "@/domain/entities";
import type { AttributeValue, EntityType } from "@/domain/entity-types";
import { fetchJson, studioHeaders } from "./api-client";
import ConfirmDeleteModal from "./confirm-delete-modal";
import MediaUpload from "./media-upload";

interface EntityDetailProps {
  entity: Entity;
  entityType: EntityType;
  storyId: string;
  onSaved: (updated: Entity) => void;
}

function formatValue(value: AttributeValue): string {
  if (value === null) return "—";
  if (Array.isArray(value)) return value.join(", ") || "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

export default function EntityDetail({ entity, entityType, storyId, onSaved }: EntityDetailProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<Record<string, AttributeValue>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [media, setMedia] = useState<MediaRef[]>(entity.media);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const supportsMedia = BASE_KIND_CATALOG[entityType.baseKind].supportsMedia;
  const active = { ...entity.attributes };
  const dirty = Object.keys(editing).length > 0;

  const save = async () => {
    setSaving(true);
    // Coerce multi-valued attributes back to arrays before sending.
    // The edit input stores them as comma-separated strings for UX convenience.
    const coerced: Record<string, AttributeValue> = {};
    for (const [key, val] of Object.entries(editing)) {
      const def = entityType.attributeDefs.find((d) => d.key === key);
      if (def?.multi && typeof val === "string") {
        coerced[key] = val.split(",").map((s) => s.trim()).filter(Boolean);
      } else {
        coerced[key] = val;
      }
    }
    try {
      const updated = await fetchJson<Entity>(
        `/api/stories/${encodeURIComponent(storyId)}/entities/${encodeURIComponent(entity.id)}`,
        {
          method: "PATCH",
          headers: studioHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({ attributes: coerced }),
        },
      );
      setEditing({});
      setMessage("Saved.");
      onSaved(updated);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const removeMedia = async (mediaId: string) => {
    try {
      const next = media.filter((row) => row.id !== mediaId);
      await fetchJson<Entity>(
        `/api/stories/${encodeURIComponent(storyId)}/entities/${encodeURIComponent(entity.id)}`,
        {
          method: "PATCH",
          headers: studioHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({ media: next }),
        },
      );
      setMedia(next);
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const portrait = media.find((row) => row.role === "portrait");
  const gallery = media.filter((row) => row.role === "gallery");

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">{entity.name}</h2>
          {entity.aliases.length > 0 && (
            <span className="text-xs text-neutral-400">aka {entity.aliases.join(", ")}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="shrink-0 rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50"
        >
          Delete
        </button>
      </div>

      {confirmDelete && (
        <ConfirmDeleteModal
          title={`Delete "${entity.name}"?`}
          description="This cannot be undone. The entity will be removed from the story bible. If it is @mentioned in any scene, deletion will be blocked."
          onConfirm={async () => {
            await fetchJson(
              `/api/stories/${encodeURIComponent(storyId)}/entities/${encodeURIComponent(entity.id)}`,
              { method: "DELETE", headers: studioHeaders() },
            );
            router.push(`/story/${storyId}`);
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}

      {supportsMedia && (
        <div className="mb-5">
          <div className="mb-2 flex items-center gap-3">
            {portrait ? (
              <div className="relative">
                <Image
                  src={portrait.url}
                  alt={portrait.caption ?? entity.name}
                  width={72}
                  height={72}
                  unoptimized
                  className="h-18 w-18 rounded-xl object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeMedia(portrait.id)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs text-neutral-500 shadow hover:text-red-500"
                  title="Remove portrait"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="flex h-18 w-18 items-center justify-center rounded-xl border-2 border-dashed border-neutral-200 bg-neutral-50">
                <span className="text-2xl text-neutral-300">☁</span>
              </div>
            )}
            <div className="space-y-1">
              <MediaUpload
                storyId={storyId}
                entityId={entity.id}
                role="portrait"
                label={portrait ? "Replace portrait" : "Upload portrait"}
                onUploaded={(id, url) =>
                  setMedia((prev) => [
                    ...prev.filter((r) => r.role !== "portrait"),
                    { id, url, role: "portrait", caption: null, createdAt: new Date() },
                  ])
                }
              />
              <MediaUpload
                storyId={storyId}
                entityId={entity.id}
                role="gallery"
                label="Add to gallery"
                onUploaded={(id, url) =>
                  setMedia((prev) => [
                    ...prev,
                    { id, url, role: "gallery", caption: null, createdAt: new Date() },
                  ])
                }
              />
            </div>
          </div>

          {gallery.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {gallery.map((row) => (
                <div key={row.id} className="relative">
                  <Image
                    src={row.url}
                    alt={row.caption ?? entity.name}
                    width={72}
                    height={72}
                    unoptimized
                    className="h-18 w-18 rounded-lg object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeMedia(row.id)}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs text-neutral-500 shadow hover:text-red-500"
                    title="Remove image"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <dl className="space-y-2">
        {entityType.attributeDefs.map((def) => {
          const value = def.key in active ? active[def.key] : editing[def.key] ?? null;
          return (
            <div key={def.key} className="flex items-start gap-3 rounded-lg bg-white p-3">
              <dt className="w-32 shrink-0 text-sm font-medium text-neutral-600">{def.label}</dt>
              <dd className="flex-1 text-sm text-neutral-800">
                {editing[def.key] !== undefined ? (
                  <input
                    type="text"
                    className="w-full rounded-md border border-neutral-300 px-2 py-1 text-sm outline-none focus:border-neutral-500"
                    value={formatValue(editing[def.key])}
                    onChange={(event) =>
                      setEditing((prev) => ({ ...prev, [def.key]: event.target.value }))
                    }
                  />
                ) : (
                  <span
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer"
                    onClick={() => setEditing((prev) => ({ ...prev, [def.key]: value }))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter")
                        setEditing((prev) => ({ ...prev, [def.key]: value }));
                    }}
                  >
                    {formatValue(value)}
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      {dirty && (
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="mt-4 rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      )}
      {message && <p className="mt-2 text-sm text-neutral-500">{message}</p>}
    </div>
  );
}
