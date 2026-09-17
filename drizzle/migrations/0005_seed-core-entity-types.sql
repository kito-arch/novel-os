-- Seed built-in entity types as global rows (story_id = NULL).
-- These are always visible to every story via the readWorld query which
-- selects WHERE story_id = $storyId OR story_id IS NULL.
-- The unique index below prevents duplicate global names.

CREATE UNIQUE INDEX entity_types_global_name_idx
  ON entity_types (lower(name))
  WHERE story_id IS NULL;

INSERT INTO entity_types (id, story_id, name, plural_name, base_kind, description, attribute_defs, origin, revision, created_at)
VALUES
  (
    '00000000-0000-4000-8000-000000000001',
    NULL,
    'character',
    'characters',
    'character',
    'Characters who drive the story',
    '[
      {"key":"nickname","label":"Nickname","kind":"text","required":false,"multi":false},
      {"key":"goals","label":"Goals","kind":"text","required":false,"multi":true},
      {"key":"fears","label":"Fears","kind":"text","required":false,"multi":true},
      {"key":"desires","label":"Desires","kind":"text","required":false,"multi":true},
      {"key":"beliefs","label":"Beliefs","kind":"text","required":false,"multi":true},
      {"key":"secrets","label":"Secrets","kind":"text","required":false,"multi":true},
      {"key":"appearance","label":"Appearance","kind":"text","required":false,"multi":true},
      {"key":"personality","label":"Personality","kind":"text","required":false,"multi":true},
      {"key":"backstory","label":"Backstory","kind":"text","required":false,"multi":false}
    ]'::jsonb,
    'core',
    0,
    '2026-01-01 00:00:00'
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    NULL,
    'place',
    'places',
    'place',
    'Places where the story unfolds',
    '[
      {"key":"description","label":"Description","kind":"text","required":false,"multi":false},
      {"key":"climate","label":"Climate","kind":"text","required":false,"multi":false},
      {"key":"notable_features","label":"Notable Features","kind":"text","required":false,"multi":true}
    ]'::jsonb,
    'core',
    0,
    '2026-01-01 00:00:00'
  ),
  (
    '00000000-0000-4000-8000-000000000003',
    NULL,
    'object',
    'objects',
    'physical',
    'A physical object of note',
    '[
      {"key":"significance","label":"Significance","kind":"text","required":false,"multi":false},
      {"key":"possessor","label":"Possessor","kind":"ref","required":false,"multi":false,"refType":"character"}
    ]'::jsonb,
    'core',
    0,
    '2026-01-01 00:00:00'
  )
ON CONFLICT DO NOTHING;
