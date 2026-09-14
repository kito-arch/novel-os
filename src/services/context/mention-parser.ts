import type { Entity } from "@/domain/entities";

export interface MentionMatch {
  name: string;
  entityId: string;
  index: number;
}

const ALPHANUMERIC = /[a-z0-9]/;

function isBoundary(character: string | undefined): boolean {
  return character === undefined || !ALPHANUMERIC.test(character);
}

// T6.3 — entity mention parser. Case-insensitive, longest-match substring scan
// against known names + aliases across ALL entity types. A match counts only at
// a word boundary ("Sarah" does not match "Sarahwin"); returns canonical entity
// names ordered by first occurrence in the text, deduplicated.
export function parseMentions(
  text: string,
  existingEntities: readonly Entity[],
): string[] {
  const textLower = text.toLowerCase();
  const length = textLower.length;

  const candidates = existingEntities
    .flatMap((entity) =>
      [entity.name, ...entity.aliases].map((alias) => ({
        alias: alias.trim(),
        entity,
      })),
    )
    .filter((candidate) => candidate.alias.length > 0);

  // Greedy longest-match first so "The Relentless" wins over "Relentless".
  const sorted = [...candidates].sort((a, b) => b.alias.length - a.alias.length);

  const matches: MentionMatch[] = [];
  const matchedEntityIds = new Set<string>();

  for (const { alias, entity } of sorted) {
    if (matchedEntityIds.has(entity.id)) continue;
    const aliasLower = alias.toLowerCase();
    let index = textLower.indexOf(aliasLower);
    while (index !== -1) {
      const start = index === 0 ? undefined : textLower[index - 1];
      const end = index + aliasLower.length >= length ? undefined : textLower[index + aliasLower.length];
      if (isBoundary(start) && isBoundary(end)) {
        matches.push({ name: entity.name, entityId: entity.id, index });
        matchedEntityIds.add(entity.id);
        break;
      }
      index = textLower.indexOf(aliasLower, index + 1);
    }
  }

  return matches.sort((a, b) => a.index - b.index).map((match) => match.name);
}

// Resolves a list of user-provided mentions (names or aliases) to canonical
// entity names + ids, deduplicated by entity, bounded to `maxMatches`. Used by
// the ContextBuilder, which receives mention lists (from ask questions or
// analysis scopes) rather than free text.
export function resolveMentions(
  mentions: readonly string[],
  existingEntities: readonly Entity[],
  maxMatches = 10,
): MentionMatch[] {
  const byName = new Map<string, Entity>();
  for (const entity of existingEntities) {
    byName.set(entity.name.toLowerCase(), entity);
    for (const alias of entity.aliases) byName.set(alias.toLowerCase(), entity);
  }

  const seen = new Set<string>();
  const resolved: MentionMatch[] = [];
  for (const mention of mentions) {
    if (resolved.length >= maxMatches) break;
    const entity = byName.get(mention.trim().toLowerCase());
    if (!entity || seen.has(entity.id)) continue;
    seen.add(entity.id);
    resolved.push({
      name: entity.name,
      entityId: entity.id,
      // We do not know the mention position for a bare mention list; assign a
      // stable sentinel so ordering stays deterministic (input order).
      index: resolved.length,
    });
  }
  return resolved;
}