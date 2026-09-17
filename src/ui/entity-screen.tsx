"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { BASE_KIND_CATALOG } from "@/domain/base-kinds";
import type { Entity } from "@/domain/entities";
import type { AttributeValue, EntityType } from "@/domain/entity-types";
import type { StoryWorld } from "@/domain/story-world";
import { fetchJson } from "@/ui/api-client";
import EntityDetail from "@/ui/entity-detail";
import EntityReferences from "@/ui/entity-references";
import MediaUpload from "@/ui/media-upload";

type Tab = "overview" | "references" | "edit";

function formatValue(value: AttributeValue): string {
  if (value === null) return "—";
  if (Array.isArray(value)) return value.join(", ") || "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export default function EntityScreen({
  storyId,
  entityId,
}: {
  storyId: string;
  entityId: string;
}) {
  const [world, setWorld] = useState<StoryWorld | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");
  const [refresh, setRefresh] = useState(0);
  const basePath = `/story/${storyId}`;

  useEffect(() => {
    let ignore = false;
    fetchJson<StoryWorld>(`/api/stories/${encodeURIComponent(storyId)}`, {

    })
      .then((w) => { if (!ignore) { setWorld(w); setLoading(false); } })
      .catch(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [storyId, refresh]);

  if (loading) return <p className="text-sm text-neutral-400">Loading…</p>;

  const entity = world?.entities.find((e) => e.id === entityId);
  if (!entity) {
    return (
      <p className="text-sm text-neutral-500">
        Entity not found.{" "}
        <Link href={basePath} className="underline">Back to story</Link>
      </p>
    );
  }

  const entityType = world!.entityTypes.find((t) => t.id === entity.entityTypeId);
  const supportsMedia = entityType ? BASE_KIND_CATALOG[entityType.baseKind].supportsMedia : false;
  const isCharacter = entityType?.baseKind === "character";

  const portrait = entity.media.find((m) => m.role === "portrait");
  const gallery = entity.media.filter((m) => m.role === "gallery");

  const relationships = isCharacter
    ? world!.relationships.filter(
        (r) => (r.fromEntityId === entityId || r.toEntityId === entityId) && !r.supersededBy,
      )
    : [];
  const facts = world!.facts
    .filter((f) => f.subject === entity.name && !f.supersededBy)
    .slice(0, 12);
  const entitiesById = new Map(world!.entities.map((e) => [e.id, e]));

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <Link href={basePath} className="text-sm text-neutral-400 hover:text-neutral-700">← Story</Link>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start gap-4">
        {supportsMedia && portrait ? (
          <Image
            src={portrait.url}
            alt={entity.name}
            width={72}
            height={72}
            unoptimized
            className="h-18 w-18 shrink-0 rounded-xl object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-2xl font-semibold text-neutral-400">
            {entity.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">{entity.name}</h1>
          {entityType && (
            <p className="mt-0.5 text-sm capitalize text-neutral-500">
              {entityType.name}
              {entity.aliases.length > 0 && <> · aka {entity.aliases.join(", ")}</>}
            </p>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-2">
        {(["overview", "references", "edit"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1 text-sm font-medium capitalize ${
              tab === t ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === "overview" && (
        <div className="space-y-6">
          {/* Attributes */}
          {entityType && entityType.attributeDefs.length > 0 && (
            <div className="rounded-xl border border-neutral-200 bg-white p-5">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                {entityType.description ?? "Profile"}
              </h2>
              <dl className="grid gap-2 sm:grid-cols-2">
                {entityType.attributeDefs.map((def) => (
                  <div key={def.key} className="rounded-lg bg-neutral-50 p-3">
                    <dt className="text-xs font-medium text-neutral-500">{def.label}</dt>
                    <dd className="mt-0.5 text-sm text-neutral-800">
                      {formatValue(entity.attributes[def.key] ?? null)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {/* Media */}
          {supportsMedia && (
            <div className="rounded-xl border border-neutral-200 bg-white p-5">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">Media</h2>
              <div className="mb-3 flex gap-2">
                <MediaUpload storyId={storyId} entityId={entity.id} role="portrait"
                  label={portrait ? "Replace portrait" : "Upload portrait"}
                  onUploaded={() => setRefresh((v) => v + 1)} />
                <MediaUpload storyId={storyId} entityId={entity.id} role="gallery"
                  label="Add to gallery" onUploaded={() => setRefresh((v) => v + 1)} />
              </div>
              {gallery.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {gallery.map((m) => (
                    <Image key={m.id} src={m.url} alt={m.caption ?? entity.name}
                      width={72} height={72} unoptimized
                      className="h-18 w-18 rounded-lg object-cover" />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Relationships — characters only */}
          {relationships.length > 0 && (
            <div className="rounded-xl border border-neutral-200 bg-white p-5">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">Relationships</h2>
              <ul className="space-y-1">
                {relationships.map((r) => {
                  const otherId = r.fromEntityId === entityId ? r.toEntityId : r.fromEntityId;
                  const other = entitiesById.get(otherId);
                  return (
                    <li key={r.id} className="flex items-baseline justify-between rounded-lg bg-neutral-50 px-3 py-2 text-sm">
                      <span className="text-neutral-800">
                        {other ? (
                          <Link href={`/story/${storyId}/entity/${other.id}`} className="font-medium hover:underline">
                            {other.name}
                          </Link>
                        ) : "unknown"}
                        {" "}<span className="text-neutral-400">— {r.kind}</span>
                      </span>
                      <span className="text-xs text-neutral-400">{r.confidence}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Facts */}
          {facts.length > 0 && (
            <div className="rounded-xl border border-neutral-200 bg-white p-5">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">Known facts</h2>
              <ul className="space-y-1">
                {facts.map((f) => (
                  <li key={f.id} className="rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
                    <span className="font-medium text-neutral-800">{f.predicate}</span>
                    {f.objectValue ? `: ${f.objectValue}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* References */}
      {tab === "references" && (
        <div className="rounded-xl border border-neutral-200 bg-white p-5">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-neutral-400">Story references</h2>
          <EntityReferences storyId={storyId} entityId={entityId} />
        </div>
      )}

      {/* Edit */}
      {tab === "edit" && entityType && (
        <div className="rounded-xl border border-neutral-200 bg-white p-5">
          <EntityDetail
            key={entity.id}
            entity={entity}
            entityType={entityType}
            storyId={storyId}
            onSaved={(_updated) => setRefresh((v) => v + 1)}
          />
        </div>
      )}
    </div>
  );
}
