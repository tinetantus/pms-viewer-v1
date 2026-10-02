ALTER TABLE comparison ADD COLUMN run_key text UNIQUE;
ALTER TABLE comment ADD COLUMN edited_at timestamptz;
CREATE TABLE comment_edit (
  id uuid PRIMARY KEY, comment_id uuid NOT NULL REFERENCES comment(id),
  body text NOT NULL, author_id text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
