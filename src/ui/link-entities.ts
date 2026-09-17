import type { Entity } from "@/domain/entities";

// Stored mention format: @[Entity Name](entityId)
const EXISTING_MENTION_RE = /@\[([^\]]+)\]\(([^)]+)\)/g;

// Replaces occurrences of entity names and aliases in `text` with
// @[Name](id) mentions. Only plain-text segments are processed — existing
// mentions are passed through unchanged. Longest labels match first so
// "John Smith" beats "John" when both are entities.
export function linkEntities(text: string, entities: Entity[]): string {
  if (entities.length === 0 || !text.trim()) return text;

  // Build label → {canonicalName, id} map, longest label first.
  const allPairs: Array<{ label: string; name: string; id: string }> = [];
  for (const entity of entities) {
    allPairs.push({ label: entity.name, name: entity.name, id: entity.id });
    for (const alias of entity.aliases) {
      const trimmed = alias.trim();
      if (trimmed) allPairs.push({ label: trimmed, name: entity.name, id: entity.id });
    }
  }
  allPairs.sort((a, b) => b.label.length - a.label.length);

  const labelMap = new Map<string, { name: string; id: string }>();
  for (const { label, name, id } of allPairs) {
    const key = label.toLowerCase();
    if (!labelMap.has(key)) labelMap.set(key, { name, id });
  }
  if (labelMap.size === 0) return text;

  // Build a combined pattern (insertion order = length-descending = longest wins).
  const escapedLabels = [...labelMap.keys()].map((l) =>
    l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const combined = new RegExp(`\\b(${escapedLabels.join("|")})\\b`, "gi");

  // Split on existing mentions so we never re-process @[...](...)  segments.
  const result: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  EXISTING_MENTION_RE.lastIndex = 0;

  while ((m = EXISTING_MENTION_RE.exec(text)) !== null) {
    if (m.index > last) result.push(replacePlain(text.slice(last, m.index)));
    result.push(m[0]);
    last = m.index + m[0].length;
  }
  if (last < text.length) result.push(replacePlain(text.slice(last)));

  return result.join("");

  function replacePlain(s: string): string {
    return s.replace(combined, (match) => {
      const entry = labelMap.get(match.toLowerCase());
      return entry ? `@[${entry.name}](${entry.id})` : match;
    });
  }
}
