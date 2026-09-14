"use client";
import { useState } from "react";
import Link from "next/link";
import { coreEntityTypes } from "@/domain/builtins";
import type { Entity } from "@/domain/entities";
import type { EntityType } from "@/domain/entity-types";
import EntityCreateModal from "./entity-create-modal";

interface EntityListProps {
  entities: Entity[];
  entityTypes: EntityType[];
  activeType: string | null;
  onTypeChange: (name: string | null) => void;
  basePath: string;
  storyId: string;
  onCreated: () => void;
}

export default function EntityList({
  entities,
  entityTypes,
  activeType,
  onTypeChange,
  basePath,
  storyId,
  onCreated,
}: EntityListProps) {
  const [creating, setCreating] = useState<string | null>(null);

  // Show all registered types + unregistered builtins as filter pills.
  const registeredNames = new Set(entityTypes.map((t) => t.name.toLowerCase()));
  const allTypes = [
    ...entityTypes,
    ...coreEntityTypes.filter((t) => !registeredNames.has(t.name.toLowerCase())),
  ];
  const filterTypes = allTypes;

  const filtered = activeType
    ? entities.filter((entity) => {
        const type = entityTypes.find((t) => t.id === entity.entityTypeId);
        return type?.name === activeType;
      })
    : entities;

  const handleCreated = () => {
    setCreating(null);
    onCreated();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onTypeChange(null)}
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            activeType === null
              ? "bg-neutral-900 text-white"
              : "bg-neutral-200 text-neutral-600 hover:bg-neutral-300"
          }`}
        >
          All
        </button>
        {filterTypes.map((type) => (
          <button
            key={type.name}
            type="button"
            onClick={() => onTypeChange(activeType === type.name ? null : type.name)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              activeType === type.name
                ? "bg-neutral-900 text-white"
                : "bg-neutral-200 text-neutral-600 hover:bg-neutral-300"
            }`}
          >
            {type.pluralName}
          </button>
        ))}
      </div>

      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-neutral-400">
          {filtered.length} {filtered.length === 1 ? "entity" : "entities"}
        </span>
        <button
          type="button"
          onClick={() => setCreating(activeType ?? "character")}
          className="rounded-md bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-neutral-700"
        >
          + New
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 p-6 text-center">
          <p className="mb-3 text-sm text-neutral-500">Nothing here yet.</p>
          <button
            type="button"
            onClick={() => setCreating(activeType ?? "character")}
            className="text-sm font-medium text-neutral-900 underline"
          >
            Create your first {activeType ?? "entity"}
          </button>
        </div>
      ) : (
        <ul className="space-y-1">
          {filtered.map((entity) => {
            const type = entityTypes.find((t) => t.id === entity.entityTypeId);
            return (
              <li key={entity.id}>
                <Link
                  href={`${basePath}/entity/${entity.id}`}
                  className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-neutral-100"
                >
                  <span className="font-medium text-neutral-800">{entity.name}</span>
                  <span className="text-xs text-neutral-400">{type?.pluralName ?? "entity"}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {creating !== null && (
        <EntityCreateModal
          storyId={storyId}
          entityTypes={entityTypes}
          initialTypeName={creating}
          onCreated={handleCreated}
          onClose={() => setCreating(null)}
        />
      )}
    </div>
  );
}
