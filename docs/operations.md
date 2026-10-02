# Operations runbook

## Runtime and deployment

Use separate web and worker services with PostgreSQL and a private S3-compatible bucket. Both services build from the repository root (`/`). Configure their Dockerfile paths directly as `infra/Dockerfile.web` and `infra/Dockerfile.worker`. Railway rejected legacy config-file assignment on 2026-10-02; the JSON examples are reference documents, not the live configuration authority. Web uses pre-deploy command `node --import tsx scripts/migrate.ts`, healthcheck `/health/ready` and timeout 120 seconds. The worker has no pre-deploy or HTTP healthcheck. Set both services to one replica in `asia-southeast1-eqsg3a` (Singapore), with app sleeping disabled. The web pre-deploy command runs migrations under an advisory lock. Deploy the worker after the first successful migration. Only the web service needs a public HTTPS domain; the worker and database do not.

Set APP_URL to the exact HTTPS origin, a random AUTH_SECRET of at least 32 bytes, DATABASE_URL, STORAGE_DRIVER=s3, and all S3 settings from `.env.example`. Use service secret/reference variables; never build arguments or NEXT_PUBLIC variables for credentials. Railway buckets require virtual-hosted addressing (`S3_FORCE_PATH_STYLE=false`) and the region/endpoint issued with the bucket. Other S3 providers can opt into path-style addressing. Originals and crops are served through authenticated application routes; never enable bucket public access.

Start with one worker replica, at least 2 GB memory for its bounded renderer and Node coordinator, and measure before scaling. Each replica processes one job. The web process buffers uploads/downloads up to UPLOAD_MAX_BYTES (100 MB default), so size memory for concurrent transfers. No cost commitment is made until the target Railway plan/resources are known.

Dockerfiles use non-root runtime users, pinned application dependencies, and a build context excluding secrets/artwork. They retain development packages needed by migration/TypeScript runtime tooling. Docker was unavailable on the implementation machine; both images subsequently built and deployed successfully on Railway on 2026-10-02. Web migrations/readiness and worker startup are verified. This does not replace the authenticated upload/approval journey, isolation verification or restore rehearsal.

The Python renderer has a minimal credential-free environment, temporary files, timeout, pixel/page limits, and Linux CPU/address-space/file limits. This is not a full hostile-document sandbox. Add and test an OS/container isolation boundary that blocks renderer network access and host access before accepting untrusted production documents. The Node coordinator still needs database/bucket access. Do not simply block the entire worker's networking.

## Health and monitoring

`GET /health/live` checks the web process. `/health/ready` checks database migrations and storage availability with bounded connection timeouts. Railway uses readiness for deployment health. Alert on readiness failures, sustained 5xx responses, failed jobs, growing queue age, expired leases, storage failures and memory/CPU exhaustion. Logs identify request/job IDs without printing credentials or original text. Audit events preserve human changes in PostgreSQL.

Jobs heartbeat every 20 seconds with a 90-second lease. Failed processing retries after 15 seconds up to three attempts. Expired leases are reclaimed; exhausted leases become failed. Operators can retry failed/cancelled jobs in project UI. Results publish only while the attempt owns its lease. Cancellation prevents stale publication; an already-running subprocess can continue until it exits/times out. Shutdown drains the current job; forced shutdown relies on lease recovery.

## AI

Defaults: disabled, transmission consent false, zero calls/day. To enable, set AI_ENABLED=true, AI_ARTWORK_POLICY_ACCEPTED=true, AI_PROVIDER=openai, AI_MODEL, AI_API_KEY and a positive AI_MAX_CALLS_PER_DAY. The adapter caps regions, bytes and output tokens, uses no tools, and requests non-stored responses. Call reservations prevent automatic duplicate external calls after interruption. AI_BUDGET_USD is an operator/provider billing limit, not a locally enforced dollar meter; configure provider limits separately. Outages retain deterministic findings and never close issues or approve artwork.

## Backup, retention and restore

Preserve originals, revisions, approvals, audit records and evidence by default. Archive hides projects; it does not delete data. No automatic deletion job is enabled. Agree retention, recovery point and recovery time targets with the owner before production.

Back up PostgreSQL and private objects together, encrypted and access restricted. Include authentication/session tables and application migrations. Use PostgreSQL-compatible `pg_dump --format=custom` with credentials supplied through environment/secret tooling, and copy bucket objects to an independent private backup. Keep checksums/key manifests from revision rows. Do not commit dumps, manifests containing private names, or secrets.

Rehearse restore into a new isolated database and bucket, never over a running production environment: pause writes/worker claims for a consistent snapshot; restore the database with a matching PostgreSQL toolchain; restore objects preserving keys; point a staging instance at the restored resources; run migrations appropriate to the recorded release; invalidate restored sessions; verify every original's SHA-256 against revision.sha256; inspect sample crops, thread history and approved revision hashes; resume workers and confirm queued/expired jobs recover without duplicate revisions/findings. Record timings and missing objects. A restore rehearsal has not yet been performed.

## Rollback and release checks

Record Git SHA, schema migration version and deployment IDs before every release. Back up first. Roll back application images only when compatible with the current schema; otherwise use a forward fix or isolated tested restore. Never rewrite an applied SQL migration. Immutable originals do not change during rollback.

Staging gate: build both images; migrate clean database; create initial administrator; invite two reviewers; upload two synthetic proofs; verify private file access rejects outsiders; annotate and correct; disposition comparison findings; collect all required approvals; confirm a new revision does not inherit approval; kill/restart a worker mid-job; restart services and verify persistence; rehearse backup restore; verify renderer isolation and bucket privacy. Repeat with representative private artwork only in the approved environment.

## References

[Railway config as code](https://docs.railway.com/config-as-code/reference), [private bucket addressing](https://docs.railway.com/storage-buckets), [healthchecks](https://docs.railway.com/deployments/healthchecks), [OpenAI structured output](https://developers.openai.com/api/docs/guides/structured-outputs).
