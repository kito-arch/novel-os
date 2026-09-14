import { z } from "zod";
import type { LlmClient } from "@/container/llm";
import type { StoryWorldStore } from "@/container/story-world-store";
import { buildContextFromWorld, renderContextPackage } from "@/services/context/builder";
import type { StoryWorld } from "@/domain";
import type { StoryEvent } from "@/domain/events";

export const ANALYSIS_TYPES = [
  "all",
  "contradictions",
  "anachronisms",
  "motivation-gaps",
  "relationship-state",
  "dangling-threads",
] as const;
export type AnalysisType = (typeof ANALYSIS_TYPES)[number];

export const REPORT_CATEGORIES = [
  "contradictions",
  "anachronisms",
  "motivation-gaps",
  "relationship-state",
  "dangling-threads",
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const ContinuityReportSchema = z.object({
  category: z.enum(REPORT_CATEGORIES),
  severity: z.enum(["info", "warning", "critical"]),
  title: z.string().min(1),
  description: z.string(),
  entityNames: z.array(z.string()).default([]),
  evidence: z.array(z.string()).default([]),
});
export type ContinuityReport = z.infer<typeof ContinuityReportSchema>;

export interface ContinuityDeps {
  store: StoryWorldStore;
  llm: LlmClient;
}

// Bound service shape in the application container (CONTINUITY_CHECKER token).
export type ContinuityChecker = (storyId: string, analysisType: AnalysisType) => Promise<ContinuityReport[]>;

const CONTINUITY_SYSTEM_PROMPT = [
  "You are a continuity editor for a novel-writing app.",
  "Analyze the enclosed story world for the requested report categories.",
  "Report real inconsistencies the context supports; do not invent.",
  'Respond with a JSON array of objects shaped {"category","severity","title","description","entityNames","evidence"}.',
  'Return an empty array [] when nothing is found.',
].join("\n");

type Detector = (world: StoryWorld) => ContinuityReport[];

// ---- structural detectors (deterministic; always run) ----------------------

const contradictions: Detector = (world) => {
  const reports: ContinuityReport[] = [];
  const factById = new Map(world.facts.map((fact) => [fact.id, fact]));

  for (const fact of world.facts) {
    if (fact.supersededBy === null) continue;
    const replacement = fact.supersededBy ? factById.get(fact.supersededBy) : undefined;
    const sameSubjectAndPredicate =
      replacement !== undefined &&
      replacement.subject === fact.subject &&
      replacement.predicate === fact.predicate;
    const valueChanged =
      sameSubjectAndPredicate && replacement!.objectValue !== fact.objectValue;

    if (valueChanged) {
      reports.push({
        category: "contradictions",
        severity: "critical",
        title: `Contradictory claims about ${fact.subject}`,
        description:
          `${fact.subject} was ${fact.predicate} "${fact.objectValue ?? ""}" and then ` +
          `"${replacement!.objectValue ?? ""}".`,
        entityNames: [fact.subject],
        evidence: [
          `old: "${fact.objectValue ?? ""}"`,
          `new: "${replacement!.objectValue ?? ""}"`,
        ],
      });
    } else if (replacement === undefined && fact.supersededBy !== null) {
      reports.push({
        category: "contradictions",
        severity: "warning",
        title: `Superseded claim without a visible replacement — ${fact.subject}`,
        description:
          `${fact.subject} ${fact.predicate} was marked superseded but no replacement fact is visible in the world.`,
        entityNames: [fact.subject],
        evidence: [`"${fact.objectValue ?? ""}"`],
      });
    } else if (sameSubjectAndPredicate && !valueChanged) {
      // Same claim restated at higher confidence — not a contradiction; the spec
      // is that restating the same fact must NOT flag a contradiction.
      continue;
    }
  }

  // An entity that believes a fact is false while the world states it.
  const activeFactLines = world.facts
    .filter((fact) => fact.supersededBy === null)
    .map((fact) =>
      [
        fact.subject,
        fact.predicate,
        ...(fact.objectValue !== null ? [fact.objectValue] : []),
      ].join(" ").toLowerCase(),
    );
  const activeFactLine = (key: string): string | undefined =>
    activeFactLines.find((line) => line.includes(key));
  for (const claim of world.knowledge) {
    if (claim.status !== "believed_false") continue;
    const key = claim.knowledgeText.toLowerCase();
    const factLine = activeFactLine(key);
    if (factLine === undefined) continue;
    if (claim.knowledgeText.length < 4) continue;
    reports.push({
      category: "contradictions",
      severity: "warning",
      title: `Belief contradicts the story — ${claim.subjectEntityId}`,
      description: `A character believes "${claim.knowledgeText}" is false while the story world records "${factLine}".`,
      entityNames: [claim.subjectEntityId],
      evidence: [`learned when: ${claim.learnedWhen ?? "?"}`, `via: ${claim.learnedVia ?? "?"}`],
    });
  }

  return reports;
};

const motivationGaps: Detector = (world) => {
  const reports: ContinuityReport[] = [];
  const entityById = new Map(world.entities.map((entity) => [entity.id, entity]));
  for (const event of world.events) {
    if (event.consequences.length > 0 && event.motivation === null) {
      reports.push({
        category: "motivation-gaps",
        severity: "warning",
        title: `Event "${event.title}" lacks motivation`,
        description:
          `This event has ${event.consequences.length} recorded consequence(s) but no stated motivation.`,
        entityNames: event.participants.map((id) => entityById.get(id)?.name ?? id),
        evidence: event.consequences,
      });
    }
  }
  return reports;
};

const relationshipState: Detector = (world) => {
  const reports: ContinuityReport[] = [];
  const entityById = new Map(world.entities.map((entity) => [entity.id, entity]));
  const replacementById = new Map(
    world.relationships.map((relationship) => [relationship.supersededBy, relationship]),
  );

  for (const relationship of world.relationships) {
    if (relationship.supersededBy !== null) {
      const replacement = replacementById.get(relationship.supersededBy);
      const from = entityById.get(relationship.fromEntityId)?.name ?? relationship.fromEntityId;
      const to = entityById.get(relationship.toEntityId)?.name ?? relationship.toEntityId;
      const changed = replacement !== undefined && replacement.kind !== relationship.kind;
      reports.push({
        category: "relationship-state",
        severity: changed ? "warning" : "info",
        title: `Relationship changed — ${from} ↔ ${to}`,
        description:
          changed
            ? `${from} and ${to} used to be ${relationship.kind}; now they are ${replacement!.kind}.`
            : `${from} and ${to}'s "${relationship.kind}" tie was superseded.`,
        entityNames: [from, to],
        evidence: [`old kind: ${relationship.kind}`],
      });
    } else if (relationship.confidence === "unknown") {
      reports.push({
        category: "relationship-state",
        severity: "info",
        title: `Uncertain relationship — ${entityById.get(relationship.fromEntityId)?.name ?? relationship.fromEntityId} ↔ ${entityById.get(relationship.toEntityId)?.name ?? relationship.toEntityId}`,
        description: `A "${relationship.kind}" tie is recorded with unknown confidence.`,
        entityNames: [
          entityById.get(relationship.fromEntityId)?.name ?? relationship.fromEntityId,
          entityById.get(relationship.toEntityId)?.name ?? relationship.toEntityId,
        ],
        evidence: [],
      });
    }
  }
  return reports;
};

const danglingThreads: Detector = (world) => {
  const reports: ContinuityReport[] = [];
  const chapterNumbers = world.scenes
    .map((scene) => scene.chapterNumber ?? Number(scene.when?.normalized?.chapter ?? NaN))
    .filter((value) => Number.isFinite(value));
  const latestChapter = chapterNumbers.length ? Math.max(...chapterNumbers) : null;

  for (const thread of world.plotThreads) {
    if (thread.status === "resolved" || thread.status === "abandoned") continue;
    const entityById = new Map(world.entities.map((entity) => [entity.id, entity]));
    const relatedNames = thread.relatedEntityIds.map((id) => entityById.get(id)?.name ?? id);

    if (thread.lastMentionedInSceneId === null && world.scenes.length >= 1) {
      reports.push({
        category: "dangling-threads",
        severity: "warning",
        title: `Dangling thread — "${thread.title}"`,
        description:
          `Introduced with status "${thread.status}" but never referenced in a later scene.`,
        entityNames: relatedNames,
        evidence: [thread.description ?? "no description recorded"],
      });
      continue;
    }

    if (thread.lastMentionedInSceneId !== null) {
      const lastScene = world.scenes.find((scene) => scene.id === thread.lastMentionedInSceneId);
      const lastChapter =
        lastScene?.chapterNumber ?? Number(lastScene?.when?.normalized?.chapter ?? NaN);
      if (
        Number.isFinite(lastChapter) &&
        latestChapter !== null &&
        latestChapter - lastChapter >= 10
      ) {
        reports.push({
          category: "dangling-threads",
          severity: "warning",
          title: `Thread "${thread.title}" not referenced for ${latestChapter - lastChapter} chapters`,
          description: `Last mentioned in chapter ${lastChapter}; the story has reached chapter ${latestChapter}.`,
          entityNames: relatedNames,
          evidence: [`last mention: chapter ${lastChapter}`, `latest: chapter ${latestChapter}`],
        });
      }
    }
  }
  return reports;
};

const DETECTORS: Record<ReportCategory, Detector> = {
  contradictions,
  anachronisms: () => [],
  "motivation-gaps": motivationGaps,
  "relationship-state": relationshipState,
  "dangling-threads": danglingThreads,
};

function isCategory(value: string): value is ReportCategory {
  return (REPORT_CATEGORIES as readonly string[]).includes(value);
}

function categoriesFor(analysisType: AnalysisType): ReportCategory[] {
  return analysisType === "all" ? [...REPORT_CATEGORIES] : [analysisType];
}

function dedupe(reports: ContinuityReport[]): ContinuityReport[] {
  const seen = new Set<string>();
  const unique: ContinuityReport[] = [];
  for (const report of reports) {
    const key = `${report.category}|${report.title}|${report.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(report);
  }
  return unique;
}

function mentionPool(world: StoryWorld): string[] {
  const names = new Set<string>();
  for (const event of world.events) {
    for (const id of [...event.participants, event.involvedObjects]) {
      const entity = world.entities.find((candidate) => candidate.id === id);
      if (entity) names.add(entity.name);
    }
  }
  for (const relationship of world.relationships) {
    for (const id of [relationship.fromEntityId, relationship.toEntityId]) {
      const entity = world.entities.find((candidate) => candidate.id === id);
      if (entity) names.add(entity.name);
    }
  }
  for (const thread of world.plotThreads) {
    for (const id of thread.relatedEntityIds) {
      const entity = world.entities.find((candidate) => candidate.id === id);
      if (entity) names.add(entity.name);
    }
  }
  for (const fact of world.facts) {
    if (fact.supersededBy !== null) names.add(fact.subject);
  }
  // Include the world's own entity names as a bound fallback so the LLM sees
  // the characters of the scene/event pool it should reason about.
  for (const entity of world.entities) names.add(entity.name);
  return [...names].slice(0, 8);
}

// One best-tier LLM pass over selectively-scoped context, merged with the
// deterministic structural findings. Extraction failures degrade gracefully to
// the structural reports (the LLM is a refinement, not a hard dependency).
async function runLlmReports(
  deps: ContinuityDeps,
  world: StoryWorld,
  categories: ReportCategory[],
): Promise<ContinuityReport[]> {
  const mentions = mentionPool(world);
  const context = buildContextFromWorld(world, mentions);
  const userMessage = [
    renderContextPackage(context),
    "",
    `ANALYSIS TASK: produce reports for categories: ${categories.join(", ")}.`,
    "Categories: contradictions, anachronisms, motivation-gaps, relationship-state, dangling-threads.",
    "anachronisms: elements (objects, knowledge, events) appearing at a time that conflicts with the established chronology.",
    'Return a JSON array of ContinuityReport objects; an empty array [] when nothing is found.',
  ].join("\n");

  try {
    const { data } = await deps.llm.extractStructured({
      tier: "best",
      systemPrompt: CONTINUITY_SYSTEM_PROMPT,
      userMessage,
      schema: z.array(ContinuityReportSchema),
    });
    return data.filter((report) => categories.includes(report.category));
  } catch {
    return [];
  }
}

// T7.3 — Continuity checker. Deterministic structural detectors catch the
// machine-checkable cases (superseded-contradiction facts, dangling threads,
// consequence-without-motivation events, superseded relationships); the
// best-tier LLM runs a second pass over selective context to find what the
// structural rules cannot (anachronisms, subtle motivation gaps). "all" runs
// every category.
export async function checkContinuity(
  deps: ContinuityDeps,
  storyId: string,
  analysisType: AnalysisType,
): Promise<ContinuityReport[]> {
  const world = await deps.store.getWorld(storyId);
  if (!world) throw new Error(`story ${storyId} not found`);

  const categories = categoriesFor(analysisType);
  const structural = categories.flatMap((category) => DETECTORS[category](world));
  const llmReports = await runLlmReports(deps, world, categories);
  return dedupe([...structural, ...llmReports]);
}

export { isCategory as isReportCategory };
export type { StoryEvent };