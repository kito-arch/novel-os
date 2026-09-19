"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { Entity } from "@/domain/entities";
import type { EntityType } from "@/domain/entity-types";

// Stored format: @[Entity Name](entityId)
const MENTION_RE = /@\[([^\]]+)\]\(([^)]+)\)/g;

interface Segment {
  type: "text" | "mention";
  value: string;
  // mention only
  entityId?: string;
  entityName?: string;
}

function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  MENTION_RE.lastIndex = 0;
  while ((match = MENTION_RE.exec(text)) !== null) {
    if (match.index > last) {
      segments.push({ type: "text", value: text.slice(last, match.index) });
    }
    segments.push({ type: "mention", value: match[0], entityName: match[1], entityId: match[2] });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ type: "text", value: text.slice(last) });
  return segments;
}

// ── Hover card ────────────────────────────────────────────────────────────────

interface HoverCardProps {
  entity: Entity;
  entityType: EntityType | undefined;
  anchorRef: React.RefObject<HTMLElement | null>;
}

function HoverCard({ entity, entityType, anchorRef }: HoverCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ position: "fixed", opacity: 0 });

  useEffect(() => {
    const anchor = anchorRef.current;
    const card = cardRef.current;
    if (!anchor || !card) return;
    const rect = anchor.getBoundingClientRect();
    const cRect = card.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow > cRect.height + 8
      ? rect.bottom + 4
      : rect.top - cRect.height - 4;
    const left = Math.min(rect.left, window.innerWidth - cRect.width - 8);
    setStyle({ position: "fixed", top, left, zIndex: 300, opacity: 1 });
  }, [anchorRef]);

  const portrait = entity.media?.find((m) => m.role === "portrait");
  const attrs = Object.entries(entity.attributes ?? {}).slice(0, 3);

  return (
    <div
      ref={cardRef}
      style={style}
      className="w-64 rounded-2xl border border-neutral-200 bg-white p-4 shadow-2xl transition-opacity"
    >
      <div className="flex items-start gap-3">
        {portrait ? (
          <Image
            src={portrait.url}
            alt={entity.name}
            width={48}
            height={48}
            unoptimized
            className="h-12 w-12 shrink-0 rounded-xl object-cover"
          />
        ) : (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-lg text-neutral-400">
            {entity.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate font-semibold text-neutral-900">{entity.name}</p>
          {entityType && (
            <p className="text-xs capitalize text-neutral-400">{entityType.name}</p>
          )}
        </div>
      </div>

      {entity.aliases && entity.aliases.length > 0 && (
        <p className="mt-2 text-xs text-neutral-500">
          Also known as: {entity.aliases.join(", ")}
        </p>
      )}

      {attrs.length > 0 && (
        <dl className="mt-3 space-y-1">
          {attrs.map(([key, val]) => {
            const def = entityType?.attributeDefs.find((d) => d.key === key);
            const label = def?.label ?? key;
            const display = Array.isArray(val) ? val.join(", ") : String(val);
            return (
              <div key={key} className="flex gap-1.5 text-xs">
                <dt className="shrink-0 font-medium text-neutral-500">{label}:</dt>
                <dd className="truncate text-neutral-700">{display}</dd>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
}

// ── Mention chip ──────────────────────────────────────────────────────────────

interface MentionChipProps {
  entityId: string;
  entityName: string;
  entity: Entity | undefined;
  entityType: EntityType | undefined;
  highlight?: boolean;
  onEntityClick?: (entityId: string) => void;
}

function MentionChip({ entityId, entityName, entity, entityType, highlight, onEntityClick }: MentionChipProps) {
  const [hovering, setHovering] = useState(false);
  const spanRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!highlight || !spanRef.current) return;
    spanRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    spanRef.current.classList.add("ring-2", "ring-yellow-400");
    const t = setTimeout(() => spanRef.current?.classList.remove("ring-2", "ring-yellow-400"), 2000);
    return () => clearTimeout(t);
  }, [highlight]);

  return (
    <>
      <span
        ref={spanRef}
        role="button"
        tabIndex={0}
        onClick={() => onEntityClick?.(entityId)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onEntityClick?.(entityId); }}
        onMouseEnter={() => entity && setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        className="inline-block cursor-pointer rounded-md bg-neutral-100 px-1.5 py-0.5 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-200"
      >
        @{entityName}
      </span>
      {hovering && entity && (
        <HoverCard
          entity={entity}
          entityType={entityType}
          anchorRef={spanRef}
        />
      )}
    </>
  );
}

// ── Scene renderer ────────────────────────────────────────────────────────────

interface SceneRendererProps {
  content: string;
  storyId: string;
  entities: Entity[];
  entityTypes: EntityType[];
  highlightEntityId?: string;
  onEntityClick?: (entityId: string) => void;
}

export default function SceneRenderer({ content, entities, entityTypes, highlightEntityId, onEntityClick }: SceneRendererProps) {
  if (!content.trim()) {
    return (
      <p className="font-serif text-[17px] italic text-neutral-300">
        Nothing written yet.
      </p>
    );
  }

  const entityById = new Map(entities.map((e) => [e.id, e]));
  const typeById = new Map(entityTypes.map((t) => [t.id, t]));

  const paragraphs = content.split(/\n{2,}/);

  return (
    <div className="space-y-4 font-serif text-[17px] leading-relaxed text-neutral-800">
      {paragraphs.map((para, pi) => {
        const segments = parseSegments(para);
        return (
          <p key={pi}>
            {segments.map((seg, si) => {
              if (seg.type === "text") {
                // Preserve single newlines within a paragraph
                return seg.value.split("\n").map((line, li, arr) => (
                  <span key={`${si}-${li}`}>
                    {line}
                    {li < arr.length - 1 && <br />}
                  </span>
                ));
              }
              const entity = entityById.get(seg.entityId!);
              const entityType = entity ? typeById.get(entity.entityTypeId) : undefined;
              return (
                <MentionChip
                  key={si}
                  entityId={seg.entityId!}
                  entityName={seg.entityName!}
                  entity={entity}
                  entityType={entityType}
                  highlight={seg.entityId === highlightEntityId}
                  onEntityClick={onEntityClick}
                />
              );
            })}
          </p>
        );
      })}
    </div>
  );
}
