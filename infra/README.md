# Deployment configuration

Use the repository root (`/`) as Docker build context for both services. `Dockerfile.web` builds Next.js and retains migration tooling; `Dockerfile.worker` installs the pinned Python processor. Web alone runs migrations and exposes readiness.

Railway rejected the legacy JSON config-file setting during the 2026-10-02 deployment repair. The two railway.*.json files remain reference examples; configure the live service settings directly instead of assigning these files as a Railway Config File. Set root `/`, Dockerfile path `infra/Dockerfile.web` or `infra/Dockerfile.worker`, Singapore region `asia-southeast1-eqsg3a`, one replica, and no app sleeping. For web, set pre-deploy command `node --import tsx scripts/migrate.ts` and healthcheck `/health/ready` (120 seconds). Leave custom start commands unset so Docker CMD is used.

The live web domain targets port 8080 and its PORT variable matches. Database and bucket credentials use references to the existing project resources. See ../docs/operations.md and the specification deployment log for validation and remaining release gates.
