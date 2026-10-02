CREATE TABLE organization (id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE member (
  user_id text PRIMARY KEY REFERENCES "user"(id),
  organization_id uuid NOT NULL REFERENCES organization(id),
  role text NOT NULL CHECK (role IN ('administrator','designer','reviewer','viewer')),
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE invitation (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organization(id),
  email text NOT NULL, role text NOT NULL CHECK (role IN ('administrator','designer','reviewer','viewer')),
  token_hash text UNIQUE NOT NULL, expires_at timestamptz NOT NULL,
  used_at timestamptz, created_by text NOT NULL REFERENCES "user"(id)
);
CREATE TABLE project (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organization(id),
  name text NOT NULL, sku text NOT NULL DEFAULT '', product text NOT NULL DEFAULT '',
  pack_size text NOT NULL DEFAULT '', market text NOT NULL DEFAULT '', language text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','changes_requested','approved')),
  archived boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
  current_revision_id uuid, created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE project_member (
  project_id uuid NOT NULL REFERENCES project(id), user_id text NOT NULL REFERENCES member(user_id),
  designer boolean NOT NULL DEFAULT false, reviewer boolean NOT NULL DEFAULT false,
  scopes text[] NOT NULL DEFAULT '{}', PRIMARY KEY(project_id,user_id),
  CHECK (scopes <@ ARRAY['marketing','qa']::text[]), CHECK (reviewer OR cardinality(scopes)=0)
);
CREATE TABLE revision (
  id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES project(id), sequence integer NOT NULL,
  object_key text NOT NULL UNIQUE, sha256 text NOT NULL, mime text NOT NULL, byte_size bigint NOT NULL,
  filename text NOT NULL, notes text NOT NULL DEFAULT '', uploaded_by text NOT NULL REFERENCES "user"(id),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','processing','ready','failed')),
  pages jsonb NOT NULL DEFAULT '[]', error text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id,sequence), UNIQUE(project_id,id)
);
ALTER TABLE project ADD CONSTRAINT current_revision_project FOREIGN KEY(id,current_revision_id) REFERENCES revision(project_id,id);
CREATE TABLE upload_intent (
  id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES project(id), user_id text NOT NULL REFERENCES "user"(id),
  object_key text UNIQUE NOT NULL, filename text NOT NULL, notes text NOT NULL DEFAULT '',
  byte_size bigint NOT NULL, mime text, sha256 text, revision_id uuid REFERENCES revision(id),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','uploaded','finalized')),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '1 hour'
);
CREATE TABLE issue (
  id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES project(id), number integer NOT NULL,
  title text NOT NULL, description text NOT NULL DEFAULT '', category text NOT NULL,
  severity text NOT NULL CHECK(severity IN ('blocking','nonblocking')),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','ready_for_verification','closed')),
  assignee text REFERENCES "user"(id), due_date date, original_revision_id uuid NOT NULL,
  fix_revision_id uuid, verified_revision_id uuid, fixed_by text REFERENCES "user"(id),
  created_by text NOT NULL REFERENCES "user"(id), version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id,number), UNIQUE(project_id,id),
  FOREIGN KEY(project_id,original_revision_id) REFERENCES revision(project_id,id),
  FOREIGN KEY(project_id,fix_revision_id) REFERENCES revision(project_id,id),
  FOREIGN KEY(project_id,verified_revision_id) REFERENCES revision(project_id,id)
);
CREATE TABLE anchor (
  id uuid PRIMARY KEY, project_id uuid NOT NULL, issue_id uuid NOT NULL, revision_id uuid NOT NULL,
  page integer NOT NULL CHECK(page>0), geometry jsonb NOT NULL,
  state text NOT NULL CHECK(state IN ('original','proposed','confirmed','unmapped')),
  created_by text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(project_id,issue_id) REFERENCES issue(project_id,id),
  FOREIGN KEY(project_id,revision_id) REFERENCES revision(project_id,id), UNIQUE(issue_id,revision_id)
);
CREATE TABLE comment (
  id uuid PRIMARY KEY, project_id uuid NOT NULL, issue_id uuid NOT NULL,
  author_id text NOT NULL REFERENCES "user"(id), body text NOT NULL,
  parent_id uuid REFERENCES comment(id), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(project_id,issue_id) REFERENCES issue(project_id,id)
);
CREATE TABLE comparison (
  id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES project(id), before_id uuid NOT NULL, after_id uuid NOT NULL,
  config jsonb NOT NULL, state text NOT NULL DEFAULT 'queued', coverage jsonb NOT NULL DEFAULT '{}',
  error text, created_by text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(project_id,before_id) REFERENCES revision(project_id,id),
  FOREIGN KEY(project_id,after_id) REFERENCES revision(project_id,id), UNIQUE(project_id,id), CHECK(before_id<>after_id)
);
CREATE TABLE finding (
  id uuid PRIMARY KEY, project_id uuid NOT NULL, comparison_id uuid NOT NULL,
  page integer NOT NULL, geometry jsonb NOT NULL, kind text NOT NULL, evidence jsonb NOT NULL,
  disposition text NOT NULL DEFAULT 'unreviewed' CHECK(disposition IN ('unreviewed','expected','needs_attention','comparison_noise')),
  reviewed_by text REFERENCES "user"(id), reason text, issue_id uuid, version integer NOT NULL DEFAULT 1,
  FOREIGN KEY(project_id,comparison_id) REFERENCES comparison(project_id,id),
  FOREIGN KEY(project_id,issue_id) REFERENCES issue(project_id,id)
);
CREATE TABLE review_round (
  id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES project(id), revision_id uuid NOT NULL,
  sha256 text NOT NULL, policy jsonb NOT NULL, state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','approved','superseded')),
  manual_by text REFERENCES "user"(id), manual_reason text, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(project_id,revision_id) REFERENCES revision(project_id,id), UNIQUE(project_id,id)
);
CREATE TABLE review_assignment (
  round_id uuid NOT NULL REFERENCES review_round(id), user_id text NOT NULL REFERENCES "user"(id),
  scope text NOT NULL CHECK(scope IN ('marketing','qa')), decision text CHECK(decision IN ('approve','request_changes')),
  note text, decided_at timestamptz, PRIMARY KEY(round_id,user_id,scope)
);
CREATE TABLE audit_event (
  id uuid PRIMARY KEY, project_id uuid REFERENCES project(id), actor_id text REFERENCES "user"(id),
  action text NOT NULL, target_id text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notification (
  id uuid PRIMARY KEY, user_id text NOT NULL REFERENCES "user"(id), project_id uuid NOT NULL REFERENCES project(id),
  message text NOT NULL, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE job (
  id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES project(id), target_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('revision','comparison')), state text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0, lease_token uuid, lease_until timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(), progress integer NOT NULL DEFAULT 0,
  error text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(kind,target_id)
);
CREATE INDEX jobs_claim ON job(state,available_at);
CREATE INDEX projects_org ON project(organization_id,updated_at DESC);
CREATE INDEX issues_project ON issue(project_id,status);
CREATE INDEX revisions_project ON revision(project_id,sequence DESC);
CREATE INDEX audit_project ON audit_event(project_id,created_at DESC);
