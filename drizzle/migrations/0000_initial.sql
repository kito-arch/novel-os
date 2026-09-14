CREATE TYPE "public"."confidence" AS ENUM('explicit', 'implied', 'inferred', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."contradiction_action" AS ENUM('supersede', 'flag_soft', 'flag_hard', 'ignore');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."knowledge_status" AS ENUM('known', 'unknown', 'believed_true', 'believed_false');--> statement-breakpoint
CREATE TYPE "public"."plot_thread_status" AS ENUM('introduced', 'active', 'resolved', 'abandoned');--> statement-breakpoint
CREATE TABLE "contradictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"existing_fact_id" uuid,
	"new_fact_description" text NOT NULL,
	"existing_fact_description" text NOT NULL,
	"action" "contradiction_action",
	"resolved" boolean DEFAULT false,
	"resolved_by_owner_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dictations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"story_id" uuid NOT NULL,
	"audio_url" text,
	"provider_job_id" text,
	"transcript" text,
	"word_count" integer,
	"duration_seconds" real,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"entity_type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb,
	"attributes" jsonb DEFAULT '{}'::jsonb,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_knowledge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"subject_entity_id" uuid NOT NULL,
	"fact_id" uuid,
	"knowledge_text" text NOT NULL,
	"status" "knowledge_status" NOT NULL,
	"learned_when" text,
	"learned_via" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid,
	"name" text NOT NULL,
	"plural_name" text NOT NULL,
	"description" text,
	"base_kind" text NOT NULL,
	"attribute_defs" jsonb DEFAULT '[]'::jsonb,
	"origin" text NOT NULL,
	"superseded_by" uuid,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"setting_id" uuid,
	"when_raw" text,
	"when_normalized" jsonb,
	"motivation" text,
	"consequences" jsonb DEFAULT '[]'::jsonb,
	"knowledge_gained" jsonb DEFAULT '[]'::jsonb,
	"knowledge_concealed" jsonb DEFAULT '[]'::jsonb,
	"participants" jsonb DEFAULT '[]'::jsonb,
	"involved_objects" jsonb DEFAULT '[]'::jsonb,
	"confidence" "confidence" NOT NULL,
	"provenance_dictation_id" uuid,
	"provenance_text" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"entity_id" uuid,
	"subject" text NOT NULL,
	"predicate" text NOT NULL,
	"object_value" text,
	"confidence" "confidence" NOT NULL,
	"provenance_dictation_id" uuid,
	"provenance_text" text,
	"superseded_by" uuid,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"url" text NOT NULL,
	"role" text NOT NULL,
	"caption" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "open_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"question" text NOT NULL,
	"related_entity_ids" jsonb DEFAULT '[]'::jsonb,
	"introduced_in_dictation_id" uuid,
	"resolved_in_dictation_id" uuid,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plot_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "plot_thread_status" DEFAULT 'introduced' NOT NULL,
	"introduced_in_scene_id" uuid,
	"last_mentioned_in_scene_id" uuid,
	"related_entity_ids" jsonb DEFAULT '[]'::jsonb,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dictation_id" uuid NOT NULL,
	"story_id" uuid NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"tier" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"proposal_data" jsonb,
	"result_summary" jsonb,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"from_entity_id" uuid NOT NULL,
	"to_entity_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"details" text,
	"confidence" "confidence" NOT NULL,
	"provenance_dictation_id" uuid,
	"provenance_text" text,
	"superseded_by" uuid,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"title" text,
	"setting_id" uuid,
	"when_raw" text,
	"when_normalized" jsonb,
	"summary" text,
	"event_ids" jsonb DEFAULT '[]'::jsonb,
	"participant_ids" jsonb DEFAULT '[]'::jsonb,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"synopsis" text,
	"owner_id" text NOT NULL,
	"story_type" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contradictions" ADD CONSTRAINT "contradictions_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contradictions" ADD CONSTRAINT "contradictions_existing_fact_id_facts_id_fk" FOREIGN KEY ("existing_fact_id") REFERENCES "public"."facts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictations" ADD CONSTRAINT "dictations_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_entity_type_id_entity_types_id_fk" FOREIGN KEY ("entity_type_id") REFERENCES "public"."entity_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_knowledge" ADD CONSTRAINT "entity_knowledge_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_knowledge" ADD CONSTRAINT "entity_knowledge_subject_entity_id_entities_id_fk" FOREIGN KEY ("subject_entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_knowledge" ADD CONSTRAINT "entity_knowledge_fact_id_facts_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."facts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_types" ADD CONSTRAINT "entity_types_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_setting_id_entities_id_fk" FOREIGN KEY ("setting_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_questions" ADD CONSTRAINT "open_questions_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plot_threads" ADD CONSTRAINT "plot_threads_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plot_threads" ADD CONSTRAINT "plot_threads_introduced_in_scene_id_scenes_id_fk" FOREIGN KEY ("introduced_in_scene_id") REFERENCES "public"."scenes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plot_threads" ADD CONSTRAINT "plot_threads_last_mentioned_in_scene_id_scenes_id_fk" FOREIGN KEY ("last_mentioned_in_scene_id") REFERENCES "public"."scenes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_dictation_id_dictations_id_fk" FOREIGN KEY ("dictation_id") REFERENCES "public"."dictations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_from_entity_id_entities_id_fk" FOREIGN KEY ("from_entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_to_entity_id_entities_id_fk" FOREIGN KEY ("to_entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_setting_id_entities_id_fk" FOREIGN KEY ("setting_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dictations_provider_job_id_idx" ON "dictations" USING btree ("provider_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entities_story_name_idx" ON "entities" USING btree ("story_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_types_story_name_idx" ON "entity_types" USING btree ("story_id","name");