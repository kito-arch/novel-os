import type { Entity } from "./entities";
import type { EntityType } from "./entity-types";
import type { StoryEvent } from "./events";
import type { EntityKnowledge } from "./knowledge";
import type { OpenQuestion, PlotThread } from "./plot-threads";
import type { Fact } from "./provenance";
import type { Relationship } from "./relationships";
import type { Scene } from "./scenes";

export interface StoryWorld {
  id: string;
  title: string;
  synopsis: string | null;
  storyType: string | null;
  revision: number;
  entityTypes: EntityType[];
  entities: Entity[];
  facts: Fact[];
  events: StoryEvent[];
  relationships: Relationship[];
  knowledge: EntityKnowledge[];
  scenes: Scene[];
  plotThreads: PlotThread[];
  openQuestions: OpenQuestion[];
}

export interface Draft {
  id: string;
  storyId: string;
  entityTypeName: string;
  fieldValues: Record<string, unknown>;
  status: "draft" | "submitted";
  createdAt: Date;
  updatedAt: Date;
}

export interface Meta {
  createdAt: Date;
  updatedAt: Date;
}