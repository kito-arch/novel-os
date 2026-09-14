"use client";
import { useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Entity } from "@/domain/entities";
import type { EntityType } from "@/domain/entity-types";

interface EntityDrawerProps {
  entity: Entity;
  entityType: EntityType | undefined;
  storyId: string;
  onClose: () => void;
}

export default function EntityDrawer({ entity, entityType, storyId, onClose }: EntityDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Small delay so the click that opened the drawer doesn't immediately close it
    const id = setTimeout(() => document.addEventListener("mousedown", handler), 50);
    return () => { clearTimeout(id); document.removeEventListener("mousedown", handler); };
  }, [onClose]);

  const portrait = entity.media?.find((m) => m.role === "portrait");
  const attrs = entityType?.attributeDefs.slice(0, 6) ?? [];

  return (
    <div
      ref={drawerRef}
      className="fixed inset-y-0 right-0 z-50 flex w-80 flex-col border-l border-neutral-200 bg-white shadow-2xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
          {entityType?.name ?? "Entity"}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-5">
        {/* Portrait + name */}
        <div className="flex items-center gap-3">
          {portrait ? (
            <Image
              src={portrait.url}
              alt={entity.name}
              width={56}
              height={56}
              unoptimized
              className="h-14 w-14 shrink-0 rounded-xl object-cover"
            />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-xl font-semibold text-neutral-400">
              {entity.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <p className="font-semibold text-neutral-900">{entity.name}</p>
            {entity.aliases.length > 0 && (
              <p className="text-xs text-neutral-400">aka {entity.aliases.join(", ")}</p>
            )}
          </div>
        </div>

        {/* Attributes */}
        {attrs.length > 0 && (
          <dl className="space-y-2">
            {attrs.map((def) => {
              const raw = entity.attributes[def.key];
              if (raw == null) return null;
              const display = Array.isArray(raw) ? raw.join(", ") : String(raw);
              if (!display) return null;
              return (
                <div key={def.key} className="rounded-lg bg-neutral-50 px-3 py-2">
                  <dt className="text-xs font-medium text-neutral-500">{def.label}</dt>
                  <dd className="mt-0.5 text-sm text-neutral-800">{display}</dd>
                </div>
              );
            })}
          </dl>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-neutral-100 px-5 py-4">
        <Link
          href={`/story/${storyId}/entity/${entity.id}`}
          onClick={onClose}
          className="block w-full rounded-lg bg-neutral-900 px-4 py-2 text-center text-sm font-medium text-white hover:bg-neutral-700"
        >
          Open full page →
        </Link>
      </div>
    </div>
  );
}
