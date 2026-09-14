"use client";
import type { Entity } from "@/domain/entities";
import type { EntityType } from "@/domain/entity-types";
import type { AttributeValue } from "@/domain/entity-types";
import type { Fact } from "@/domain/provenance";
import type { Relationship } from "@/domain/relationships";
import Image from "next/image";

export interface CharacterSheetData {
  entity: Entity;
  entityType: EntityType;
  entitiesById: Map<string, Entity>;
  relationships: Relationship[];
  facts: Fact[];
  sceneCount: number;
}

function formatValue(value: AttributeValue): string {
  if (value === null) return "—";
  if (Array.isArray(value)) return value.join(", ") || "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

export default function CharacterSheet({ entity, entityType, entitiesById, relationships, facts, sceneCount }: CharacterSheetData) {
  const relations = relationships
    .filter((row) => row.fromEntityId === entity.id || row.toEntityId === entity.id)
    .filter((row) => row.supersededBy === null);

  const factsAbout = facts
    .filter((row) => row.subject === entity.name && row.supersededBy === null)
    .slice(0, 12);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">{entity.name}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {entityType.description ?? "Character"}
            {entity.aliases.length > 0 && <> · aka {entity.aliases.join(", ")}</>}
          </p>
        </div>
        <div className="text-right text-xs text-neutral-400">
          <div>{sceneCount} scenes</div>
          <div>{factsAbout.length} recorded facts</div>
        </div>
      </div>

      {entity.media.filter((row) => row.role === "portrait").slice(0, 1).map((row) => (
        <Image
          key={row.id}
          src={row.url}
          alt={row.caption ?? entity.name}
          width={160}
          height={160}
          unoptimized
          className="h-40 w-40 rounded-xl object-cover"
        />
      ))}

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">Profile</h2>
        <dl className="grid gap-2 sm:grid-cols-2">
          {entityType.attributeDefs.map((def) => (
            <div key={def.key} className="rounded-lg bg-white p-3">
              <dt className="text-xs font-medium text-neutral-500">{def.label}</dt>
              <dd className="mt-0.5 text-sm text-neutral-800">{formatValue(entity.attributes[def.key] ?? null)}</dd>
            </div>
          ))}
        </dl>
      </section>

      {relations.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">Relationships</h2>
          <ul className="space-y-1">
            {relations.map((row) => {
              const otherId = row.fromEntityId === entity.id ? row.toEntityId : row.fromEntityId;
              const other = entitiesById.get(otherId);
              return (
                <li key={row.id} className="flex items-baseline justify-between rounded-lg bg-white px-3 py-2 text-sm">
                  <span className="text-neutral-800">
                    {other?.name ?? "unknown"} <span className="text-neutral-400">— {row.kind}</span>
                  </span>
                  <span className="text-xs text-neutral-400">{row.confidence}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {factsAbout.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">Known facts</h2>
          <ul className="space-y-1">
            {factsAbout.map((row) => (
              <li key={row.id} className="rounded-lg bg-white px-3 py-2 text-sm text-neutral-700">
                <span className="font-medium text-neutral-800">{row.predicate}</span>
                {row.objectValue ? `: ${row.objectValue}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}