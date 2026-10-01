# PMS Viewer v1

Self-hosted packaging artwork review based on [the product specification](PACKAGING_PROOF_SPEC.md).

## Local development

Install Node.js 24.14.1 and npm 11.11.0, then run from this repository:

```sh
npm ci
npm run dev
```

Open http://localhost:3000. The current page is a scaffold, not a review workflow. No credentials or services are required yet. Future integrations use the variables documented in .env.example; copy it to apps/web/.env.local when needed. Never expose server secrets with NEXT_PUBLIC_ prefixes.

## Validation

```sh
npm run check
npm start
```

The check runs ESLint, TypeScript, and a production build. GET /health/live checks the web process only. Database/storage readiness is pending. PORT is respected by Next.js; the web service binds all interfaces.

## Structure and status

apps/web contains the runnable Next.js shell. apps/worker, packages/domain, packages/db, packages/viewer, services/processor, tests, and infra reserve the specification's boundaries. Their README files describe pending implementation.

Authentication, database, uploads, viewer, queue, AI, and deployment are pending. AI defaults off. The Git repository is local on main with no remote. Parent sample artwork stays outside this repository.

Next: inspect representative PDFs and perform viewer/comparison spikes, then choose auth/renderer/queue dependencies. Docker and local database setup remain part of BASE-01.

Framework setup reference: [Next.js installation](https://nextjs.org/docs/app/getting-started/installation). Dependencies are pinned exactly in package manifests and package-lock.json.

Tooling limitation: ESLint 9.39.5 is pinned for compatibility with the React plugin bundled by eslint-config-next 16.3.8. npm marks ESLint 9 unsupported. ESLint 10.11.0 was tested and fails on the plugin's removed getFilename API; revisit this pin when the bundled plugin supports ESLint 10.
