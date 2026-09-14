import type { StoryWorldStore } from "@/container/story-world-store";
import type { EntityKnowledge, KnowledgeStatus } from "@/domain/knowledge";

// Bound service shape in the application container (KNOWLEDGE_QUERY token).
export type KnowledgeQuery = (
  storyId: string,
  entityId: string,
  factDescription: string,
  timeline?: string | null,
) => Promise<KnowledgeStatus>;

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "is", "are", "was", "were", "has", "have",
  "had", "of", "in", "on", "at", "to", "for", "with", "by", "from", "that", "this",
  "does", "do", "did", "who", "what", "when", "where", "why", "how", "not", "be",
  "it", "its", "he", "she", "they", "them", "his", "her", "their", "you", "i", "we",
]);

function significantTokens(text: string): Set<string> {
  const tokens = text.toLowerCase().split(/\W+/).filter((token) => token.length > 0);
  return new Set(tokens.filter((token) => !STOP_WORDS.has(token)));
}

// Token-overlap heuristic: the fact description counts as mentioned when at
// least half of its significant tokens appear in the knowledge claim, and it
// shares at least the strongest token ("John killed Michael" ↔ "John ... Michael").
function matchesClaim(row: EntityKnowledge, factDescription: string): boolean {
  const wanted = significantTokens(factDescription);
  const present = significantTokens(row.knowledgeText);
  if (wanted.size === 0) return false;
  let overlapping = 0;
  for (const token of wanted) {
    if (present.has(token)) overlapping += 1;
  }
  if (overlapping === 0) return false;
  return overlapping / wanted.size >= 0.5;
}

function chapterOf(text: string): number | null {
  const match = text.match(/ch(?:apter)?\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function isLearnedBy(row: EntityKnowledge, timeline: string | null | undefined): boolean {
  if (timeline == null || timeline.trim() === "") return true;
  if (row.learnedWhen == null || row.learnedWhen.trim() === "") return true;
  const queryChapter = chapterOf(timeline);
  const learnedChapter = chapterOf(row.learnedWhen);
  // Only apply the timeline gate when both sides carry a comparable chapter
  // reference; otherwise we treat the claim as known.
  if (queryChapter === null || learnedChapter === null) return true;
  return learnedChapter <= queryChapter;
}

function statusOfClaims(claims: EntityKnowledge[]): KnowledgeStatus {
  if (claims.length === 0) return "unknown";
  // "known" wins over the belief strata; otherwise the strongest belief state.
  if (claims.some((row) => row.status === "known")) return "known";
  if (claims.some((row) => row.status === "believed_true")) return "believed_true";
  if (claims.some((row) => row.status === "believed_false")) return "believed_false";
  return "unknown";
}

// T7.2 — Knowledge query: does `entityId` know `factDescription` by this point
// in the story? Queries the knowledge rows of the entity, matches the fact by
// token overlap, and considers the timeline (what the entity has learned by
// `timeline`). Returns the KnowledgeStatus of the strongest matching claim, or
// "unknown" when nothing matches.
export async function doesEntityKnow(
  store: StoryWorldStore,
  storyId: string,
  entityId: string,
  factDescription: string,
  timeline?: string | null,
): Promise<KnowledgeStatus> {
  const rows = await store.getKnowledge(storyId, entityId);
  const claims = rows.filter(
    (row) =>
      row.status !== "unknown" && matchesClaim(row, factDescription) && isLearnedBy(row, timeline),
  );
  return statusOfClaims(claims);
}

// Supporting context for the /knowledge route: the matching claims plus their
// timeline annotations, used to explain WHY a status was returned.
export async function knowledgeContext(
  store: StoryWorldStore,
  storyId: string,
  entityId: string,
  factDescription: string,
  timeline?: string | null,
): Promise<{ status: KnowledgeStatus; claims: EntityKnowledge[]; entityName: string | null }> {
  const entity = await store.getEntity(storyId, entityId);
  const rows = await store.getKnowledge(storyId, entityId);
  const claims = rows.filter((row) => matchesClaim(row, factDescription) && isLearnedBy(row, timeline));
  return {
    status: statusOfClaims(claims),
    claims,
    entityName: entity?.name ?? null,
  };
}