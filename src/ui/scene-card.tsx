"use client";
import type { Scene } from "@/domain/scenes";
import type { StoryWorld } from "@/domain/story-world";

function whenLabel(scene: Scene): string {
  if (!scene.when) return "";
  const parts = scene.when.normalized
    ? [scene.when.normalized.chapter, scene.when.normalized.day, scene.when.normalized.hour]
        .filter(Boolean)
        .join(" · ")
    : scene.when.raw;
  return parts;
}

export default function SceneCard({ scene, world }: { scene: Scene; world: StoryWorld }) {
  const setting = scene.settingId ? world.entities.find((entity) => entity.id === scene.settingId) : null;
  const participants = world.entities
    .filter((entity) => scene.participantIds.includes(entity.id))
    .slice(0, 5);
  const when = whenLabel(scene);

  return (
    <article className="rounded-xl border border-neutral-200 bg-white p-5">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h3 className="font-semibold text-neutral-900">{scene.title ?? "Untitled scene"}</h3>
        {when && <span className="text-xs text-neutral-400">{when}</span>}
      </div>

      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {scene.chapterNumber !== null && scene.chapterNumber !== undefined && (
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-500">Ch. {scene.chapterNumber}</span>
        )}
        {setting && <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-500">At {setting.name}</span>}
        {participants.map((participant) => (
          <span key={participant.id} className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-600">
            {participant.name}
          </span>
        ))}
      </div>

      {scene.summary && <p className="text-sm text-neutral-700">{scene.summary}</p>}
    </article>
  );
}