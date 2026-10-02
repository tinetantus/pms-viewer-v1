ALTER TABLE anchor ADD COLUMN source_anchor_id uuid REFERENCES anchor(id);
ALTER TABLE anchor ADD COLUMN confidence double precision;
ALTER TABLE anchor ADD COLUMN evidence jsonb NOT NULL DEFAULT '{}';
