CREATE TABLE request_limit (key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL);
CREATE INDEX notifications_user ON notification(user_id,created_at DESC);
CREATE INDEX comments_issue ON comment(issue_id,created_at);
CREATE UNIQUE INDEX one_open_round_per_project ON review_round(project_id) WHERE state='open';
