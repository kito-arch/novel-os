"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchJson, studioHeaders } from "./api-client";

interface Reference {
  sceneId: string;
  sceneTitle: string | null;
  chapterId: string | null;
  chapterTitle: string | null;
  snippet: string;
}

interface EntityReferencesProps {
  storyId: string;
  entityId: string;
}

export default function EntityReferences({ storyId, entityId }: EntityReferencesProps) {
  const [refs, setRefs] = useState<Reference[] | null>(null);

  useEffect(() => {
    let ignore = false;
    fetchJson<Reference[]>(
      `/api/stories/${encodeURIComponent(storyId)}/entities/${encodeURIComponent(entityId)}/references`,
      { headers: studioHeaders() },
    )
      .then((data) => { if (!ignore) setRefs(data); })
      .catch(() => { if (!ignore) setRefs([]); });
    return () => { ignore = true; };
  }, [storyId, entityId]);

  if (refs === null) {
    return <p className="text-sm text-neutral-400">Loading references…</p>;
  }

  if (refs.length === 0) {
    return (
      <p className="text-sm italic text-neutral-400">
        Not yet referenced in any scene. Use <kbd className="rounded border border-neutral-200 bg-neutral-50 px-1 font-mono text-xs">@</kbd> in the scene editor to link this entity.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {refs.map((ref) => {
        const href = `/story/${storyId}/scene/${ref.sceneId}?highlight=${entityId}`;
        return (
          <Link
            key={ref.sceneId}
            href={href}
            className="block rounded-xl border border-neutral-100 bg-neutral-50 p-3 hover:border-neutral-300 hover:bg-white transition-colors"
          >
            <div className="mb-1 flex items-baseline gap-1.5 text-xs font-medium text-neutral-500">
              {ref.chapterTitle && <span>{ref.chapterTitle}</span>}
              {ref.chapterTitle && ref.sceneTitle && <span className="text-neutral-300">›</span>}
              {ref.sceneTitle && <span>{ref.sceneTitle}</span>}
              {!ref.chapterTitle && !ref.sceneTitle && <span>Untitled scene</span>}
            </div>
            <p className="text-sm text-neutral-700 leading-relaxed">
              {ref.snippet}
            </p>
          </Link>
        );
      })}
    </div>
  );
}
