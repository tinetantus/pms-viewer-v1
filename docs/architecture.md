# Implementation decisions

## Persistence and access

The deployment remains one organization per application instance, PostgreSQL, a separate worker, and private S3-compatible storage. Organization IDs scope projects and organization membership. Project-owned rows use project IDs and composite foreign keys to reject cross-project references.

The proposed Prisma default is replaced by node-postgres with versioned SQL migrations. The implementation needs explicit project-row locks, composite constraints, atomic job claims, and Better Auth's PostgreSQL adapter; one connection/transaction model keeps those checks visible. Migrations run once as a release command under an advisory lock. Better Auth's version-pinned migration API owns authentication tables; application SQL migrations are immutable once applied.

All mutations serialize on the project row where they can affect approval. Clients send expected versions. Upload finalization is idempotent per upload intent and allocates revision numbers while holding the project lock. Original bytes use immutable keys and are checked against SHA-256 on finalization and downloads.

Better Auth manages password hashing, sessions, cookie security, origin validation, and authentication throttling. Public signup is disabled. Administrators generate expiring, single-use invite links. The application authorizes every project read, file, generated crop, mutation, and job retry. Administrator membership does not grant reviewer signature authority.

## Processing

The queue uses PostgreSQL `FOR UPDATE SKIP LOCKED`, lease tokens, heartbeats, delayed retries, and transactional result publication. Attempt-specific asset keys prevent stale workers from replacing evidence. Python receives temporary local files and a minimal environment without application credentials. PDFium renders with native annotation objects disabled. Pillow handles images; OpenCV groups deterministic differences. Rendered geometry remains unrotated and normalized; PDF.js converts overlays for display rotation.

Boundaries: 100 MB upload default, 50 PDF pages, 40 million expanded image pixels, 16 million comparison pixels per page, 500 region findings, 120-second subprocess timeout. Linux adds address-space, CPU and per-file limits. Windows needs an OS job-object sandbox before production processing of hostile files. A subprocess alone is not a complete sandbox; production renderer networking isolation remains a release requirement.

Comparison uses explicit page maps or conservative thumbnail matching. Translation is applied only at adequate phase-correlation confidence and within eight raster pixels; scale and rotation are never silently normalized away. Geometry differences and ambiguous mappings are partial results. Exclusions reduce coverage; native text findings explicitly retain extraction uncertainty. AI remains disabled until configured and a transmission policy is accepted.

## Private sample observations

All eight supplied files are single-page landscape A3 PDFs (1190.55 × 841.89 points), rotation zero, UserUnit 1, and unencrypted. Thai and Latin native text is extractable. Fonts include embedded subset names for Kanit, Prompt, DB Adman Rounded, Proxima Nova, and others. Actual Thai extraction quality still needs reviewer validation.

No native annotation dictionaries were present in the supplied PDFs. Visible proof marks/signoffs are page content; disabling native annotations cannot remove them. Use versioned exclusion regions or obtain clean exports. Local metadata/previews are in ignored `artifacts/inspection/`; neither source PDFs nor screenshots belong in Git.

## Local environment

Docker was unavailable on the implementation machine. `embedded-postgres` starts a private loopback development cluster; the application database uses UTF-8 for Thai. This development helper is not the production database architecture. Local filesystem storage is opt-in, outside the web public directory, and rejected in production unless explicitly allowed. Production requires S3-compatible private storage.

## References checked

- [Better Auth PostgreSQL and schema](https://better-auth.com/docs/concepts/database)
- [Better Auth configuration](https://better-auth.com/docs/reference/options)
- [PDF.js display API](https://mozilla.github.io/pdf.js/api/)
- [PDFium Python API](https://pypdfium2.readthedocs.io/en/stable/python_api.html)
- Version-pinned library types and source code in node_modules are the implementation API reference.

## Anchor proposals

Comparison transforms with at least 0.7 alignment confidence and bounded normalized translation may create separate proposed anchors. Each proposal records its source anchor, comparison and transform; existing anchors are never overwritten by a worker. The UI uses dashed outlines and requires human confirmation or manual replacement. Rejection marks the proposal unmapped. A later revision never automatically reopens or re-verifies a closed issue.
