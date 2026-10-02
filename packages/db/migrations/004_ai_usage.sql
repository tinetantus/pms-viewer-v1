CREATE TABLE ai_usage (
  comparison_id uuid PRIMARY KEY REFERENCES comparison(id),
  provider text NOT NULL, model text NOT NULL, state text NOT NULL DEFAULT 'reserved',
  metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
