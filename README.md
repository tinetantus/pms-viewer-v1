# PMS Viewer v1

Private packaging proofing with immutable revisions, precise PDF/image annotations, deterministic comparison, and revision-bound Marketing/QA approval. The canonical implementation tracker is [PACKAGING_PROOF_SPEC.md](PACKAGING_PROOF_SPEC.md).

## Local setup

Requires Node 24.14.1, npm 11 and Python 3.11+. Run from the repository root in PowerShell:

```powershell
npm ci
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r services/processor/requirements.txt
npm run local:setup
npm run local:db
```

Keep the database terminal running. In another terminal:

```powershell
npm run db:migrate
$env:PMS_ADMIN_PASSWORD = '<choose a unique password of at least 12 characters>'
npm run admin:create -- you@example.com 'Your Name'
Remove-Item Env:PMS_ADMIN_PASSWORD
npm run dev
```

Start `npm run worker` in a third terminal. Open http://localhost:3000 and sign in. Create a project, upload artwork, then invite colleagues and assign project capabilities/scopes. The initial-admin command only works before an administrator exists. For later users, generate invitation links from the dashboard and share them yourself.

On Linux/macOS use `.venv/bin/python` and shell-appropriate environment assignment. The setup helper generates ignored random credentials and private storage paths; it preserves an existing `.env`. Keep `.env` and `apps/web/.env.local` consistent when changing web settings. The worker reads root `.env`; Next reads the web copy.

## Implemented workflows

- Invite-only sessions, organization/project access, account enable/disable, project creation/edit/archive and membership.
- Validated uploads with immutable storage keys, checksums, numbered revisions, thumbnails, durable background processing and retries/cancellation.
- Viewport-sized PDF.js rendering, images, zoom/pan/rotation, side-by-side navigation, overlay opacity, layers and physical measurement from PDF units.
- Rectangle/pin issues, category/severity/assignee filters, threaded replies, edit history, notifications, correction/verification/reopen and manual revision anchors.
- Pixel/text differences, conservative page mapping, alignment, evidence crops, exclusion regions, uncertainty reporting and human dispositions.
- Required Marketing/QA review snapshots, concurrency checks, blocking-issue gates, explicit manual comparison fallback and historical approvals.
- Optional bounded OpenAI descriptions/issue suggestions. Off by default; requires explicit artwork transmission consent and configured call/token limits. No AI request was made during local validation.

## Checks

```powershell
npm run check
npm test
.venv/Scripts/python.exe tests/processor_test.py
npm run test:integration
node --env-file=.env --import tsx tests/collaboration.test.ts
node --env-file=.env --import tsx tests/findings.test.ts
node --env-file=.env --import tsx tests/anchor-workflow.test.ts
node --env-file=.env --import tsx tests/recovery.test.ts
npm run test:browser
node tests/dialog-check.mjs
```

Integration/browser checks require the local database, web server and worker. They create disposable synthetic organizations/accounts; credentials are written only to ignored `local-data/test-accounts.json`. Browser checks require installed Google Chrome. Processor tests generate synthetic PDFs in ignored artifacts. Tests must never target production.

Supplied private artwork can be imported explicitly with `node scripts/import-local-samples.mjs ../sample` after integration fixtures exist. It stays local and is excluded from Git. Optional sample visual checks use `tests/sample-check.mjs`; see tests/README.md.

## Deployment status

Web and worker Docker deployments succeeded on Railway on 2026-10-02 in Singapore (`asia-southeast1-eqsg3a`), using the existing production environment. Both build from repository root with their respective Dockerfiles. Live service settings are configured directly because Railway rejected legacy JSON config-file assignment. Web readiness, login and unauthenticated-access checks pass; worker startup is confirmed. See [operations](docs/operations.md) and the specification deployment log. Renderer network isolation, authenticated deployed workflow checks and backup-restore rehearsal remain release requirements.

PDF screen previews are not certified colour proofs. Flattened marks remain page content. Text extraction and automatic alignment can be uncertain; partial comparisons require human review. Large or difficult documents can hit configured resource limits.

Tooling note: ESLint 9.39.5 is pinned because the React plugin bundled with eslint-config-next 16.3.8 fails under ESLint 10 (`getFilename`). npm marks ESLint 9 unsupported; revisit when the plugin supports ESLint 10.

Stop the development server before running a production build/start smoke test; both use the same Next output directory.
